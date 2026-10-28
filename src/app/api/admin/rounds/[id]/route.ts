import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { z } from "zod";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  registrationStart: z.string().datetime().optional(),
  registrationEnd: z.string().datetime().optional(),
  matchingMode: z.enum(["OPEN", "CROSS_CATEGORY"]).optional(),
  revealAt: z.string().datetime().nullable().optional(),
});

// PATCH — edit round config (only before assignments are finalized)
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const round = await db.round.findUnique({ where: { id } });
    if (!round) return jsonError("ROUND_NOT_FOUND", 404);
    if (["active", "guessing_open", "revealed", "archived"].includes(round.status)) {
      return jsonError("ROUND_LOCKED", 403);
    }
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) return jsonError("VALIDATION", 400);
    const data: Record<string, unknown> = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.registrationStart) data.registrationStart = new Date(parsed.data.registrationStart);
    if (parsed.data.registrationEnd) data.registrationEnd = new Date(parsed.data.registrationEnd);
    if (parsed.data.matchingMode) data.matchingMode = parsed.data.matchingMode;
    if (parsed.data.revealAt !== undefined) data.revealAt = parsed.data.revealAt ? new Date(parsed.data.revealAt) : null;
    if (data.registrationStart && data.registrationEnd) {
      if ((data.registrationEnd as Date) <= (data.registrationStart as Date)) {
        return jsonError("INVALID_DATES", 400);
      }
    }
    const updated = await db.round.update({ where: { id }, data });
    await audit(admin.id, admin.displayName, "ROUND_UPDATED", id, data as Record<string, unknown>);
    return Response.json({ ok: true, round: updated });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// DELETE — only drafts can be deleted
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const round = await db.round.findUnique({ where: { id } });
    if (!round) return jsonError("ROUND_NOT_FOUND", 404);
    if (round.status !== "draft") return jsonError("ONLY_DRAFTS_DELETABLE", 403);
    await db.round.delete({ where: { id } });
    await audit(admin.id, admin.displayName, "ROUND_DELETED", id, { name: round.name });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
