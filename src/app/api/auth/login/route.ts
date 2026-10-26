import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/phone";
import { setSessionCookie, jsonError } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

const attempts = new Map<string, { n: number; resetAt: number }>();

export async function POST(req: Request) {
  await ensureBootstrap();
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (!email || !password) return jsonError("MISSING_FIELDS", 400);

    // Basic login rate limiting per email
    const key = email.toLowerCase();
    const now = Date.now();
    const rec = attempts.get(key);
    if (rec && rec.n >= 10 && rec.resetAt > now) {
      return jsonError("RATE_LIMITED", 429);
    }
    if (!rec || rec.resetAt < now) {
      attempts.set(key, { n: 1, resetAt: now + 15 * 60 * 1000 });
    } else {
      rec.n++;
    }

    const user = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      return jsonError("INVALID_CREDENTIALS", 401);
    }
    attempts.delete(key);
    await setSessionCookie(user.id);
    await audit(user.id, user.displayName, "LOGIN", user.id, null);
    return Response.json({
      ok: true,
      user: { id: user.id, displayName: user.displayName, role: user.role },
    });
  } catch {
    return jsonError("BAD_REQUEST", 400);
  }
}
