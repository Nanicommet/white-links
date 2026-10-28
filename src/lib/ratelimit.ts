// ── In-memory rate limiter (per serverless instance) ────────────
// Layer-1 brake against brute force and spam. Vercel runs multiple
// instances, so this is a soft limit by design; the sensitive flows
// it guards (login, recovery) are additionally protected by scrypt
// hashing and non-enumerable responses.

type Bucket = { n: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Periodically purge expired buckets so the map cannot grow forever
const SWEEP_INTERVAL = 10 * 60 * 1000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(k);
  }
}

/**
 * Consume one attempt from the bucket `key`.
 * Returns false when the caller exceeded `max` attempts inside `windowMs`.
 */
export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { n: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.n >= max) return false;
  b.n += 1;
  return true;
}

/** Clear a bucket — used after a successful authentication. */
export function rateLimitReset(key: string): void {
  buckets.delete(key);
}

/** Best-effort client IP from proxy headers (Vercel/Next). */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
