import { requireAdmin, jsonError } from "@/lib/auth";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import {
  transitionRound,
  finalizeMatching,
  revealRound,
  previewMatching,
  matchingDiagnostics,
  enableAdvanceRegistration,
} from "@/lib/lifecycle";
import type { RoundStatus } from "@/lib/constants";

export const runtime = "nodejs";

// POST — server-enforced lifecycle actions.
// body: { action: string, confirm?: boolean }
// Actions: open_registration | close_registration | finalize_matching |
//          open_guessing | reveal | archive | preview_matching |
//          diagnostics | advance_registration
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params;
    const { action, confirm } = (await req.json()) as { action?: string; confirm?: boolean };
    if (!action) return jsonError("MISSING_ACTION", 400);

    switch (action) {
      case "open_registration": {
        const round = await db.round.findUnique({ where: { id } });
        if (!round) return jsonError("ROUND_NOT_FOUND", 404);
        const now = new Date();
        if (round.registrationEnd <= now) return jsonError("REGISTRATION_END_IN_PAST", 400);
        const res = await transitionRound(id, "registration_open", admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "TRANSITION_FAILED", 400);
        return Response.json({ ok: true });
      }
      case "close_registration": {
        const res = await transitionRound(id, "registration_closed", admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "TRANSITION_FAILED", 400);
        return Response.json({ ok: true });
      }
      case "finalize_matching": {
        // Explicit confirmation required (spec: never bypass server validation)
        if (!confirm) return jsonError("CONFIRMATION_REQUIRED", 400);
        const result = await finalizeMatching(id, admin.id, admin.displayName);
        if (!result.ok) return jsonError(result.error ?? "MATCHING_FAILED", 400, { phase: "finalize" });
        return Response.json({ ok: true, assigned: result.assigned });
      }
      case "preview_matching": {
        const result = await previewMatching(id, admin.id, admin.displayName);
        return Response.json(result);
      }
      case "diagnostics": {
        const diag = await matchingDiagnostics(id);
        return Response.json(diag);
      }
      case "open_guessing": {
        const round = await db.round.findUnique({ where: { id } });
        if (!round) return jsonError("ROUND_NOT_FOUND", 404);
        // Opening guessing fixes the window start at "now" so deadline
        // checks behave consistently for admin-triggered openings.
        const res = await transitionRound(id, "guessing_open" as RoundStatus, admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "TRANSITION_FAILED", 400);
        await db.round.update({
          where: { id },
          data: {
            guessingStart: new Date(),
            guessingDeadline: round.guessingDeadline ?? round.gameEnd ?? new Date(Date.now() + 24 * 3600 * 1000),
          },
        });
        await audit(admin.id, admin.displayName, "GUESSING_WINDOW_OPENED", id, null);
        return Response.json({ ok: true });
      }
      case "reveal": {
        if (!confirm) return jsonError("CONFIRMATION_REQUIRED", 400);
        const res = await revealRound(id, admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "REVEAL_FAILED", 400);
        return Response.json({ ok: true });
      }
      case "archive": {
        const res = await transitionRound(id, "archived", admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "TRANSITION_FAILED", 400);
        return Response.json({ ok: true });
      }
      case "advance_registration": {
        const res = await enableAdvanceRegistration(id, admin.id, admin.displayName);
        if (!res.ok) return jsonError(res.error ?? "FAILED", 400);
        return Response.json({ ok: true, roundId: res.roundId });
      }
      default:
        return jsonError("UNKNOWN_ACTION", 400);
    }
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
