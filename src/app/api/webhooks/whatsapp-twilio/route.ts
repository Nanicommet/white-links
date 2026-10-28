import { NextRequest } from "next/server";
import { ensureBootstrap } from "@/lib/bootstrap";
import { verifyTwilioSignature, whatsappProvider, whatsappStatus } from "@/lib/whatsapp";
import { handleWhatsAppInbound } from "@/lib/messaging";
import { getSettings } from "@/lib/lifecycle";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// Twilio signs the exact public URL it requested. Behind Vercel the
// x-forwarded-* headers carry that public origin; fall back to req.url.
function publicUrl(req: NextRequest): string {
  const u = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  return `${proto}://${host}${u.pathname}${u.search}`;
}

// GET — quick browser check (no secrets returned, honest states only)
export async function GET() {
  const configured = whatsappProvider() === "twilio" && whatsappStatus(false).configured;
  return Response.json({
    provider: "twilio",
    configured,
    hint: configured
      ? "POST messages from Twilio to this URL."
      : "Set WHATSAPP_PROVIDER=twilio + TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_WHATSAPP_FROM",
  });
}

// POST — inbound WhatsApp messages + delivery status callbacks from Twilio.
// X-Twilio-Signature verified (HMAC-SHA1 over URL + sorted params), then the
// same anonymous 1/2 command routing as the Meta webhook is reused.
export async function POST(req: NextRequest) {
  await ensureBootstrap();
  const raw = await req.text();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!authToken) {
    return new Response("Twilio webhook not configured: set TWILIO_AUTH_TOKEN", { status: 503 });
  }
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(raw));
  const signature = req.headers.get("x-twilio-signature");
  if (!signature || !verifyTwilioSignature(publicUrl(req), params, signature)) {
    return new Response("Invalid signature", { status: 401 });
  }

  try {
    // 1) Delivery status callbacks for outbound messages (StatusCallback):
    //    they carry MessageStatus but no user Body/From pair.
    if (params.MessageStatus) {
      const providerMessageId = params.MessageSid ?? params.SmsSid ?? "";
      if (providerMessageId) {
        const { db } = await import("@/lib/db");
        const message = await db.message.findUnique({ where: { providerMessageId } });
        if (message) {
          const s = params.MessageStatus;
          const mapped =
            s === "failed" || s === "undelivered"
              ? "FAILED"
              : s === "delivered" || s === "read" || s === "sent"
                ? "SENT"
                : message.deliveryStatus;
          if (mapped !== message.deliveryStatus) {
            await db.message.update({ where: { id: message.id }, data: { deliveryStatus: mapped } });
          }
        }
      }
      return Response.json({ received: true });
    }

    // 2) Inbound member message: "whatsapp:+216…" → "+216…" (Meta format),
    //    so the shared phone normalizer behaves identically.
    const from = (params.From ?? "").replace(/^whatsapp:/i, "").trim();
    const text = (params.Body ?? "").trim();
    const sid = params.MessageSid ?? params.SmsMessageSid ?? `tw-${Date.now()}`;
    if (!from || !text) return Response.json({ received: true }); // media-only or empty — ignore politely

    const result = await handleWhatsAppInbound(from, text, sid);
    if (result.handled && result.reply) {
      // Same rule as the Meta webhook: the admin's DB test-mode toggle also
      // governs inbound auto-replies.
      const { sendWhatsAppText } = await import("@/lib/whatsapp");
      const settings = await getSettings();
      await sendWhatsAppText(from, result.reply, { testMode: settings.whatsappTestMode });
    }
    return Response.json({ received: true });
  } catch {
    await audit(null, "system", "WHATSAPP_TWILIO_INBOUND_ERROR", params.MessageSid ?? "unknown", null);
    // Always 200 to prevent provider retry storms
    return Response.json({ received: true });
  }
}
