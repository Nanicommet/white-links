import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — winners' reward preference form data for the NEXT round
export async function GET() {
  try {
    const user = await requireUser();
    // My most recent revealed round where I won
    const revealedRounds = await db.round.findMany({
      where: { status: { in: ["revealed", "archived"] } },
      orderBy: { updatedAt: "desc" },
      take: 3,
      select: { id: true, name: true },
    });
    let wonIn: string | null = null;
    for (const r of revealedRounds) {
      const assignments = await db.assignment.findMany({
        where: { roundId: r.id, status: "ACTIVE" },
        select: { giverId: true, recipientId: true },
      });
      const admirerOf = new Map(assignments.map((a) => [a.recipientId, a.giverId]));
      const guess = await db.guess.findUnique({
        where: { roundId_guesserId: { roundId: r.id, guesserId: user.id } },
      });
      if (guess && admirerOf.get(user.id) === guess.guessedId) {
        wonIn = r.id;
        break;
      }
    }
    const nextRound = await db.round.findFirst({
      where: { status: { in: ["draft", "registration_open", "registration_closed"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!wonIn || !nextRound) {
      return Response.json({ eligible: false });
    }
    const existing = await db.rewardPreference.findMany({
      where: { roundId: nextRound.id, winnerId: user.id },
      orderBy: { rank: "asc" },
    });
    // Eligible participants (excluding self) for the dropdown
    const participants = await db.registration.findMany({
      where: { roundId: nextRound.id, status: "ACTIVE", verificationStatus: "APPROVED" },
      include: { user: { select: { id: true, displayName: true } } },
    });
    return Response.json({
      eligible: true,
      nextRound: { id: nextRound.id, name: nextRound.name, status: nextRound.status },
      existing: existing.map((e) => ({ targetId: e.targetId, rank: e.rank, status: e.status })),
      participants: participants
        .filter((p) => p.userId !== user.id)
        .map((p) => ({ id: p.userId, displayName: p.user.displayName })),
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — save ranked preferences (up to 3). Never overrides matching rules.
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { roundId, ranked } = (await req.json()) as { roundId?: string; ranked?: string[] };
    if (!roundId || !Array.isArray(ranked) || ranked.length === 0 || ranked.length > 3) {
      return jsonError("INVALID_PREFERENCES", 400);
    }
    const round = await db.round.findUnique({ where: { id: roundId } });
    if (!round) return jsonError("ROUND_NOT_FOUND", 404);
    if (!["draft", "registration_open", "registration_closed"].includes(round.status)) {
      return jsonError("ROUND_NOT_ACCEPTING", 400);
    }
    // Eligibility: must be a winner of the immediately previous revealed round
    const prevRound = await db.round.findFirst({
      where: { status: { in: ["revealed", "archived"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (!prevRound) return jsonError("NOT_ELIGIBLE", 403);
    const assignments = await db.assignment.findMany({
      where: { roundId: prevRound.id, status: "ACTIVE" },
      select: { giverId: true, recipientId: true },
    });
    const admirerOf = new Map(assignments.map((a) => [a.recipientId, a.giverId]));
    const guess = await db.guess.findUnique({
      where: { roundId_guesserId: { roundId: prevRound.id, guesserId: user.id } },
    });
    if (!guess || admirerOf.get(user.id) !== guess.guessedId) {
      return jsonError("NOT_ELIGIBLE", 403);
    }
    // Targets must be registered & eligible in the target round, not self, unique
    const seen = new Set<string>();
    for (const targetId of ranked) {
      if (targetId === user.id) return jsonError("CANNOT_PREFER_SELF", 400);
      if (seen.has(targetId)) return jsonError("DUPLICATE_PREFERENCE", 400);
      seen.add(targetId);
      const target = await db.registration.findFirst({
        where: { roundId, userId: targetId, status: "ACTIVE", verificationStatus: "APPROVED" },
      });
      if (!target) return jsonError("INVALID_TARGET", 400);
    }
    await db.rewardPreference.deleteMany({ where: { roundId, winnerId: user.id } });
    for (let i = 0; i < ranked.length; i++) {
      await db.rewardPreference.create({
        data: {
          roundId,
          earnedInRoundId: prevRound.id,
          winnerId: user.id,
          targetId: ranked[i],
          rank: i + 1,
          status: "PENDING",
        },
      });
    }
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
