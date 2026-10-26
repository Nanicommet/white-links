import { ensureBootstrap } from "@/lib/bootstrap";
import { tick } from "@/lib/lifecycle";
import { db } from "@/lib/db";

export const runtime = "nodejs";

// Idempotent lifecycle tick — safe to call repeatedly (cron or manual).
async function run() {
  await ensureBootstrap();
  const result = await tick();
  // Record job execution for observability (deduplicated per minute)
  const key = `tick:${Math.floor(Date.now() / 60000)}`;
  try {
    await db.jobLog.create({
      data: { jobKey: key, type: "TICK", detail: JSON.stringify(result) },
    });
  } catch {
    /* duplicate minute — fine */
  }
  return result;
}

export async function GET(req: Request) {
  if (!(await cronAuthorized(req))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function POST(req: Request) {
  if (!(await cronAuthorized(req))) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
  const result = await run();
  return Response.json({ ok: true, ...result });
}

// Optional protection: set CRON_SECRET in the environment, then callers
// (Vercel Cron, cron-job.org…) must send it as `?key=…` or
// `Authorization: Bearer …`. When CRON_SECRET is unset the endpoint stays
// open — transitions are idempotent and time-based, so this is safe by
// design, but setting the secret is recommended in production.
async function cronAuthorized(req: Request): Promise<boolean> {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("key") === secret) return true;
  const auth = req.headers.get("authorization") ?? "";
  return auth === `Bearer ${secret}`;
}
