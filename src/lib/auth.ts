import crypto from "crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { SESSION_COOKIE, SESSION_DAYS } from "@/lib/constants";

// ── Stateless HMAC-signed session tokens (no external JWT dep) ──

type SessionPayload = { uid: string; exp: number; v: number };

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

async function getSecret(): Promise<string> {
  if (process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 16) {
    return process.env.AUTH_SECRET;
  }
  const s = await db.settings.findUnique({ where: { id: "global" } });
  if (s?.authSecret) return s.authSecret;
  const secret = crypto.randomBytes(32).toString("hex");
  await db.settings.upsert({
    where: { id: "global" },
    update: { authSecret: secret },
    create: { id: "global", authSecret: secret },
  });
  return secret;
}

function sign(data: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export async function createSessionToken(userId: string): Promise<string> {
  const secret = await getSecret();
  const payload: SessionPayload = {
    uid: userId,
    exp: Date.now() + SESSION_DAYS * 24 * 3600 * 1000,
    v: 1,
  };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  const secret = await getSecret();
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = sign(body, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string): Promise<void> {
  const token = await createSessionToken(userId);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // sandbox preview is served over https proxy; lax cookie works either way
    path: "/",
    maxAge: SESSION_DAYS * 24 * 3600,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  role: string;
  phoneVerified: boolean;
  restrictedUntil: Date | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const payload = await verifySessionToken(token);
  if (!payload) return null;
  const user = await db.user.findUnique({
    where: { id: payload.uid },
    select: {
      id: true,
      email: true,
      displayName: true,
      phone: true,
      role: true,
      phoneVerified: true,
      restrictedUntil: true,
    },
  });
  return user;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("UNAUTHENTICATED", 401);
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "ADMIN") throw new AuthError("FORBIDDEN", 403);
  return user;
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Standard JSON error helper for API routes
export function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return Response.json({ error: message, ...extra }, { status });
}
