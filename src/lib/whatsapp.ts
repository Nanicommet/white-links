// ─────────────────────────────────────────────────────────────────
// WhatsApp Business Cloud API provider (official API only)
// All credentials live in backend env vars — never exposed to client.
// Honest states: returns ok:false when not configured. No fake sends.
// ─────────────────────────────────────────────────────────────────

export interface WhatsAppStatus {
  configured: boolean;
  missing: string[];
  testMode: boolean;
  phoneNumberId: string | null;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function whatsappStatus(testMode: boolean): WhatsAppStatus {
  const required = [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ];
  const missing = required.filter((k) => !env(k));
  return {
    configured: missing.length === 0,
    missing,
    testMode,
    phoneNumberId: env("WHATSAPP_PHONE_NUMBER_ID") ?? null,
  };
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  simulated?: boolean;
  error?: string;
}

export async function sendWhatsAppText(to: string, body: string): Promise<SendResult> {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  const version = env("WHATSAPP_API_VERSION") ?? "v21.0";

  if (!token || !phoneId) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }

  // Test mode validates routing without sending real messages
  if (process.env.WHATSAPP_TEST_MODE === "true") {
    return { ok: true, simulated: true, providerMessageId: `sim.${Date.now()}.${Math.random().toString(36).slice(2, 10)}` };
  }

  try {
    const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: to.replace(/^\+/, ""),
        type: "text",
        text: { preview_url: false, body },
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message?: string };
    };
    if (!res.ok || data.error) {
      return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, providerMessageId: data.messages?.[0]?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "NETWORK_ERROR" };
  }
}

export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  const secret = env("WHATSAPP_APP_SECRET");
  if (!secret || !signatureHeader) return false;
  // Lazy import to avoid sync crypto issues in edge cases — crypto is fine in node runtime
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto");
  const expected =
    "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(signatureHeader);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Anonymity-preserving wrapper for forwarded messages
export function wrapAnonymously(body: string, isReply: boolean): string {
  const header = isReply
    ? "💌 *WHITE LINKS* — Réponse de ton admirateur secret :"
    : "💌 *WHITE LINKS* — Message de ton ami secret :";
  return `${header}\n\n${body}`;
}
