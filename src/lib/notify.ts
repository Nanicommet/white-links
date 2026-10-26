import { db } from "@/lib/db";

// ── Idempotent notification creation ─────────────────────────────

export async function notify(input: {
  userId: string;
  roundId?: string | null;
  type: string;
  title: string;
  body: string;
  dedupeKey?: string | null;
}): Promise<boolean> {
  if (input.dedupeKey) {
    const existing = await db.notification.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) return false;
  }
  await db.notification.create({
    data: {
      userId: input.userId,
      roundId: input.roundId ?? null,
      type: input.type,
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey ?? null,
    },
  });
  return true;
}
