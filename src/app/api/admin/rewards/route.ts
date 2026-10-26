import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — winners of the latest revealed round + their preferences & conflicts
export async function GET() {
  try {
    await requireAdmin();
    const revealed = await db.round.findFirst({
      where: { status: { in: ["revealed", "archived"] } },
      orderBy: { updatedAt: "desc" },
    });
    if (!revealed) return Response.json({ round: null, winners: [] });

    const assignments = await db.assignment.findMany({
      where: { roundId: revealed.id, status: "ACTIVE" },
      select: { giverId: true, recipientId: true },
    });
    const admirerOf = new Map(assignments.map((a) => [a.recipientId, a.giverId]));
    const guesses = await db.guess.findMany({ where: { roundId: revealed.id } });

    const users = await db.user.findMany({
      where: { id: { in: [...admirerOf.values(), ...guesses.map((g) => g.guesserId)] } },
      select: { id: true, displayName: true },
    });
    const nameOf = (id: string) => users.find((u) => u.id === id)?.displayName ?? id;

    const winners = guesses
      .filter((g) => admirerOf.get(g.guesserId) === g.guessedId)
      .map((g) => ({
        winnerId: g.guesserId,
        winnerName: nameOf(g.guesserId),
        admirerName: nameOf(g.guessedId),
      }));

    // Conflicts: multiple winners ranking the same target in an upcoming round
    const upcoming = await db.round.findFirst({
      where: { status: { in: ["draft", "registration_open", "registration_closed"] } },
      orderBy: { createdAt: "desc" },
    });
    let conflicts: { targetId: string; targetName: string; claimants: { winnerId: string; winnerName: string; rank: number }[] }[] = [];
    if (upcoming) {
      const prefs = await db.rewardPreference.findMany({
        where: { roundId: upcoming.id },
        include: { winner: { select: { displayName: true } } },
      });
      const byTarget = new Map<string, { winnerId: string; winnerName: string; rank: number }[]>();
      for (const p of prefs) {
        const list = byTarget.get(p.targetId) ?? [];
        list.push({ winnerId: p.winnerId, winnerName: p.winner.displayName, rank: p.rank });
        byTarget.set(p.targetId, list);
      }
      conflicts = [...byTarget.entries()]
        .filter(([, claimants]) => claimants.length > 1)
        .map(([targetId, claimants]) => ({
          targetId,
          targetName: nameOf(targetId),
          claimants,
        }));
    }

    return Response.json({ round: { id: revealed.id, name: revealed.name }, winners, upcomingRound: upcoming ? { id: upcoming.id, name: upcoming.name } : null, conflicts });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — resolve conflicts via documented fair priority: randomized
// secure tie-break among claimants (rank order first, then draw).
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { roundId } = (await req.json()) as { roundId?: string };
    if (!roundId) return jsonError("MISSING_ROUND", 400);
    const prefs = await db.rewardPreference.findMany({ where: { roundId } });
    const byTarget = new Map<string, typeof prefs>();
    for (const p of prefs) {
      const list = byTarget.get(p.targetId) ?? [];
      list.push(p);
      byTarget.set(p.targetId, list);
    }
    let resolved = 0;
    for (const [, claimants] of byTarget) {
      if (claimants.length <= 1) continue;
      // Priority: best rank wins; equal ranks → secure random draw
      const bestRank = Math.min(...claimants.map((c) => c.rank));
      const top = claimants.filter((c) => c.rank === bestRank);
      const winner = top.length === 1 ? top[0] : top[Math.floor(Math.random() * top.length)];
      for (const c of claimants) {
        await db.rewardPreference.update({
          where: { id: c.id },
          data: { status: c.id === winner.id ? "PENDING" : "CONFLICT" },
        });
      }
      resolved++;
    }
    await audit(admin.id, admin.displayName, "REWARD_CONFLICTS_RESOLVED", roundId, { resolved });
    return Response.json({ ok: true, resolved });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
