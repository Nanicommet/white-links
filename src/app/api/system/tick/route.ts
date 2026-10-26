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

export async function GET() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}

export async function POST() {
  const result = await run();
  return Response.json({ ok: true, ...result });
}
