import { NextRequest } from "next/server";
import crypto from "crypto";
import { ensureBootstrap } from "@/lib/bootstrap";
import { verifyWebhookSignature } from "@/lib/whatsapp";
import { handleWhatsAppInbound } from "@/lib/messaging";
import { getSettings } from "@/lib/lifecycle";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// GET — webhook verification handshake (Meta WhatsApp Cloud API)
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (!expected) {
    return new Response("WhatsApp webhook not configured: set WHATSAPP_VERIFY_TOKEN", { status: 503 });
  }
  // Timing-safe token comparison
  const a = Buffer.from(token ?? "");
  const b = Buffer.from(expected);
  if (mode === "subscribe" && a.length === b.length && crypto.timingSafeEqual(a, b) && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// POST — inbound WhatsApp events (status callbacks + messages)
// Signature-verified, deduplicated, and routed anonymously.
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const raw = await req.text();
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyWebhookSignature(raw, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    const payload = JSON.parse(raw) as {
      entry?: {
        changes?: {
          value?: {
            messages?: { from: string; id: string; text?: { body?: string } }[];
            statuses?: { id: string; status: string }[];
          };
        }[];
      }[];
    };

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        for (const msg of value?.messages ?? []) {
          const text = msg.text?.body ?? "";
          try {
            const result = await handleWhatsAppInbound(msg.from, text, msg.id);
            if (result.handled && result.reply) {
              // Reply via provider (sendWhatsAppText imported lazily to avoid circular deps).
              // Test mode comes from the admin's DB setting so the Settings
              // toggle also governs inbound auto-replies, not just forwards.
              const { sendWhatsAppText } = await import("@/lib/whatsapp");
              const settings = await getSettings();
              await sendWhatsAppText(msg.from, result.reply, { testMode: settings.whatsappTestMode });
            }
          } catch {
            await audit(null, "system", "WHATSAPP_INBOUND_ERROR", msg.id, null);
          }
        }
        // Delivery status callbacks → update provider status
        for (const st of value?.statuses ?? []) {
          const { db } = await import("@/lib/db");
          const message = await db.message.findUnique({ where: { providerMessageId: st.id } });
          if (message) {
            const mapped = st.status === "failed" ? "FAILED" : st.status === "delivered" || st.status === "read" ? "SENT" : message.deliveryStatus;
            if (mapped !== message.deliveryStatus) {
              await db.message.update({ where: { id: message.id }, data: { deliveryStatus: mapped } });
            }
          }
        }
      }
    }
    // Always 200 to prevent provider retry storms
    return Response.json({ received: true });
  } catch {
    return Response.json({ received: true });
  }
}
