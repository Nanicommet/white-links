import crypto from "crypto";

// ── Phone normalization (Tunisia-first) ──────────────────────────
// Accepts 8-digit local numbers, 00216/+216 prefixed, or generic
// international numbers. Returns E.164-ish "+<digits>" or null.
// Robust against common user pastes: "+216 24 555 123", "00216...",
// "0 24 555 123" (leading zero), and doubled prefixes "+216216…".

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  // Leading-zero local paste: "024555123" → "24555123"
  if (/^0\d{8}$/.test(s)) s = s.slice(1);
  // Doubled-prefix pastes (user typed +216 into the +216-prefixed field):
  // "+216216245551 23" → "+21624555123", "21621624555123" → "21624555123"
  while (/^\+216216/.test(s)) s = "+" + s.slice(4);
  while (/^216216\d{8}$/.test(s)) s = s.slice(3);
  if (/^216\d{8}$/.test(s)) s = "+" + s;
  else if (/^\d{8}$/.test(s)) s = "+216" + s;
  else if (/^\d{10,15}$/.test(s) && !s.startsWith("+")) s = "+" + s;
  if (/^\+216[2459]\d{7}$/.test(s)) return s;
  if (/^\+\d{8,15}$/.test(s)) return s;
  return null;
}

export function isTunisian(phone: string): boolean {
  return phone.startsWith("+216");
}

export function maskPhone(phone: string): string {
  if (phone.length < 6) return "***";
  return phone.slice(0, 4) + "••••" + phone.slice(-2);
}

// ── Password hashing (scrypt, no external deps) ──────────────────

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, hash] = stored.split("$");
    if (scheme !== "scrypt" || !salt || !hash) return false;
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, "hex");
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

export function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const bytes = crypto.randomBytes(12);
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
