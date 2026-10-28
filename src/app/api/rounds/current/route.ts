import { db } from "@/lib/db";
import { ensureBootstrap } from "@/lib/bootstrap";
import { tick } from "@/lib/lifecycle";

export const runtime = "nodejs";

// Public live status for the landing page. Only aggregate, safe info.
export async function GET() {
  await ensureBootstrap();
  await tick();

  const round = await db.round.findFirst({
    where: { status: { in: ["registration_open", "registration_closed", "matching_pending", "active", "guessing_open", "revealed"] } },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { registrations: { where: { status: "ACTIVE" } } } },
    },
  });

  const nextRound = round
    ? await db.round.findFirst({
        where: { status: "draft", registrationStart: { gt: new Date() } },
        orderBy: { registrationStart: "asc" },
        select: { id: true, name: true, registrationStart: true, registrationEnd: true },
      })
    : null;

  // Last revealed round for "previous edition" mention
  const lastRevealed = await db.round.findFirst({
    where: { status: { in: ["revealed", "archived"] } },
    orderBy: { updatedAt: "desc" },
    select: { name: true, updatedAt: true },
  });

  return Response.json({
    round: round
      ? {
          id: round.id,
          name: round.name,
          status: round.status,
          registrationStart: round.registrationStart,
          registrationEnd: round.registrationEnd,
          gameStart: round.gameStart,
          gameEnd: round.gameEnd,
          guessingStart: round.guessingStart,
          guessingDeadline: round.guessingDeadline,
          revealAt: round.revealAt,
          matchingMode: round.matchingMode,
          participantCount: round._count.registrations,
        }
      : null,
    nextRound,
    lastRevealed: lastRevealed ? { name: lastRevealed.name, updatedAt: lastRevealed.updatedAt } : null,
    serverTime: new Date().toISOString(),
  });
}
