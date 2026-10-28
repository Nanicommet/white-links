import { db } from "@/lib/db";
import { verifyPassword } from "@/lib/phone";
import { setSessionCookie, jsonError } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { audit } from "@/lib/audit";
import { rateLimit, rateLimitReset, clientIp } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  await ensureBootstrap();
  try {
    const { email, password } = (await req.json()) as { email?: string; password?: string };
    if (!email || !password) return jsonError("MISSING_FIELDS", 400);

    // Brute-force brakes: per account AND per IP address.
    // (In-memory per instance — a soft first layer on serverless.)
    const key = email.toLowerCase().trim();
    const ip = clientIp(req);
    if (!rateLimit(`login-email:${key}`, 10, 15 * 60 * 1000) || !rateLimit(`login-ip:${ip}`, 30, 15 * 60 * 1000)) {
      return jsonError("RATE_LIMITED", 429);
    }

    const user = await db.user.findUnique({ where: { email: key } });
    if (!user || !verifyPassword(password, user.passwordHash)) {
      // Same error for unknown email and wrong password: no enumeration.
      return jsonError("INVALID_CREDENTIALS", 401);
    }
    // Success clears the brute-force counters (a correct password proves
    // legitimacy; wrong attempts never clear anything).
    rateLimitReset(`login-email:${key}`);
    rateLimitReset(`login-ip:${ip}`);
    await setSessionCookie(user.id, user.passwordHash);
    await audit(user.id, user.displayName, "LOGIN", user.id, null);
    return Response.json({
      ok: true,
      user: { id: user.id, displayName: user.displayName, role: user.role },
    });
  } catch {
    return jsonError("BAD_REQUEST", 400);
  }
}
