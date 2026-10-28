// Quick verification of the Twilio webhook signature validator.
// Self-contained — no database needed. Run: bun scripts/test-twilio-signature.ts

process.env.TWILIO_AUTH_TOKEN = "test-auth-token-12345";

import { verifyTwilioSignature } from "../src/lib/whatsapp";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto") as typeof import("crypto");

const authToken = "test-auth-token-12345";
const url = "https://white-links.vercel.app/api/webhooks/whatsapp-twilio";

// Sample Twilio payload (inbound member message with accents/emoji)
const params: Record<string, string> = {
  SmsMessageSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  NumMedia: "0",
  ProfileName: "Yasmine",
  SmsSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  WaId: "21697690531",
  SmsStatus: "received",
  Body: "1 Salut! Ça va 😊",
  To: "whatsapp:+14155238886",
  MessagingServiceSid: "MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  NumSegments: "1",
  MessageSid: "SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  AccountSid: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  From: "whatsapp:+21697690531",
  ApiVersion: "2010-04-01",
};

// Official Twilio signing algorithm (same as twilio npm's validateRequest)
function twilioSign(token: string, u: string, p: Record<string, string>): string {
  const data = u + Object.keys(p).sort().map((k) => k + p[k]).join("");
  return crypto.createHmac("sha1", token).update(Buffer.from(data, "utf-8")).digest("base64");
}

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✅" : "❌"} ${name}`);
  if (!cond) failures++;
}

const good = twilioSign(authToken, url, params);
check("valid signature accepted", verifyTwilioSignature(url, params, good));

check("wrong signature rejected", !verifyTwilioSignature(url, params, "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="));

const tampered = { ...params, Body: "1 hacked" };
check("tampered body rejected", !verifyTwilioSignature(url, tampered, good));

const wrongUrl = "https://evil.example.com/api/webhooks/whatsapp-twilio";
check("different URL rejected", !verifyTwilioSignature(wrongUrl, params, good));

check("missing header rejected", !verifyTwilioSignature(url, params, null));

const noToken: Record<string, string> = {};
check("no params signed correctly accepted", verifyTwilioSignature(url, noToken, twilioSign(authToken, url, noToken)));

// Address helper parity check: webhook strips "whatsapp:" before normalizePhone
const from = (params.From ?? "").replace(/^whatsapp:/i, "").trim();
check(`From "${params.From}" → "${from}" (normalizePhone-ready)`, from === "+21697690531");

process.exit(failures === 0 ? 0 : 1);
