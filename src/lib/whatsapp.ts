// ─────────────────────────────────────────────────────────────────
// WhatsApp provider layer — two backends, one interface:
//   1. "meta"    WhatsApp Business Cloud API (graph.facebook.com)
//   2. "twilio"  Twilio WhatsApp (api.twilio.com)
// Selected via WHATSAPP_PROVIDER ("meta" by default).
// All credentials live in backend env vars — never exposed to client.
// Honest states: returns ok:false when not configured. No fake sends.
// ─────────────────────────────────────────────────────────────────

export type WhatsAppProvider = "meta" | "twilio";

export interface WhatsAppStatus {
  provider: WhatsAppProvider;
  configured: boolean;
  missing: string[];
  testMode: boolean;
  /** Sender identity: Meta phone-number-id, or the Twilio WhatsApp sender. */
  phoneNumberId: string | null;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export function whatsappProvider(): WhatsAppProvider {
  return env("WHATSAPP_PROVIDER")?.toLowerCase() === "twilio" ? "twilio" : "meta";
}

export function whatsappStatus(testMode: boolean): WhatsAppStatus {
  if (whatsappProvider() === "twilio") {
    const required = ["WHATSAPP_PROVIDER", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"];
    const missing = required.filter((k) => !env(k));
    return {
      provider: "twilio",
      configured: missing.length === 0,
      missing,
      testMode,
      phoneNumberId: env("TWILIO_WHATSAPP_FROM") ?? null,
    };
  }
  const required = [
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_APP_SECRET",
  ];
  const missing = required.filter((k) => !env(k));
  return {
    provider: "meta",
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

/** "whatsapp:+216…" — accepts +216… / 216… / whatsapp:+216… inputs. */
function waAddress(raw: string): string {
  const t = raw.trim().replace(/^whatsapp:/i, "");
  return `whatsapp:${t.startsWith("+") ? t : `+${t}`}`;
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  opts?: { testMode?: boolean }
): Promise<SendResult> {
  // Test mode validates routing without sending real messages.
  // Priority: explicit setting passed by the caller (the admin's DB toggle)
  // → falls back to the environment variable for legacy/standalone calls.
  const testMode = opts?.testMode ?? process.env.WHATSAPP_TEST_MODE === "true";
  if (testMode) {
    return { ok: true, simulated: true, providerMessageId: `sim.${Date.now()}.${Math.random().toString(36).slice(2, 10)}` };
  }

  if (whatsappProvider() === "twilio") return sendViaTwilio(to, body);
  return sendViaMeta(to, body);
}

// ── Twilio branch ────────────────────────────────────────────────
async function sendViaTwilio(to: string, body: string): Promise<SendResult> {
  const sid = env("TWILIO_ACCOUNT_SID");
  const authToken = env("TWILIO_AUTH_TOKEN");
  const from = env("TWILIO_WHATSAPP_FROM");
  if (!sid || !authToken || !from) {
    return { ok: false, error: "NOT_CONFIGURED" };
  }
  try {
    const form = new URLSearchParams({
      To: waAddress(to),
      From: waAddress(from),
      Body: body,
    });
    // Optional delivery-status callbacks (delivered/read/failed updates).
    const callback = env("TWILIO_STATUS_CALLBACK_URL");
    if (callback) form.set("StatusCallback", callback);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${sid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(15000),
      }
    );
    const data = (await res.json().catch(() => ({}))) as {
      sid?: string;
      message?: string;
    };
    if (!res.ok || !data.sid) {
      return { ok: false, error: data.message ?? `HTTP ${res.status}` };
    }
    return { ok: true, providerMessageId: data.sid };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "NETWORK_ERROR" };
  }
}

// ── Meta Cloud API branch ────────────────────────────────────────
async function sendViaMeta(to: string, body: string): Promise<SendResult> {
  const token = env("WHATSAPP_ACCESS_TOKEN");
  const phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  const version = env("WHATSAPP_API_VERSION") ?? "v21.0";

  if (!token || !phoneId) {
    return { ok: false, error: "NOT_CONFIGURED" };
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

// ── Webhook signature verification ───────────────────────────────

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

/**
 * Twilio request validation (official algorithm):
 *   base64(HMAC-SHA1(authToken, url + concat(sorted key+value pairs)))
 * The URL must be the exact public URL Twilio requested (no trailing slash).
 */
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null
): boolean {
  const authToken = env("TWILIO_AUTH_TOKEN");
  if (!authToken || !signatureHeader) return false;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require("crypto") as typeof import("crypto");
  const data =
    url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");
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
