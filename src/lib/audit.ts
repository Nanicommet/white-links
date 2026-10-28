import { db } from "@/lib/db";

// ── Audit logging for sensitive/administrative actions ──────────

export async function audit(
  actorId: string | null,
  actorName: string,
  action: string,
  target: string | null,
  meta: Record<string, unknown> | null
): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        actorId,
        actorName,
        action,
        target,
        meta: meta ? JSON.stringify(meta) : null,
      },
    });
  } catch {
    // Audit must never break the main flow, but try a retry once
    try {
      await db.auditLog.create({
        data: { actorId, actorName, action, target, meta: meta ? JSON.stringify(meta) : null },
      });
    } catch {
      /* swallow */
    }
  }
}
