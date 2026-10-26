import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { tick } from "@/lib/lifecycle";

export const runtime = "nodejs";

// GET — reveal data. Server verifies round eligibility before returning
// any identity (acceptance tests #15, #16).
export async function GET() {
  try {
    const user = await requireUser();
    await tick();
    const round = await db.round.findFirst({
      where: { status: { in: ["guessing_open", "revealed", "archived", "active"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return Response.json({ revealed: false, reason: "NO_ROUND" });

    const registration = await db.registration.findUnique({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    if (!registration || registration.status !== "ACTIVE") {
      return Response.json({ revealed: false, reason: "NOT_REGISTERED", round: { status: round.status } });
    }

    const now = new Date();
    if (round.status === "active" || round.status === "guessing_open") {
      return Response.json({
        revealed: false,
        round: {
          id: round.id,
          name: round.name,
          status: round.status,
          guessingDeadline: round.guessingDeadline,
          revealAt: round.revealAt,
        },
      });
    }

    // Round is revealed/archived → safe to return identities to this member
    const assignments = await db.assignment.findMany({
      where: { roundId: round.id, status: "ACTIVE" },
      select: { giverId: true, recipientId: true },
    });
    const myOut = assignments.find((a) => a.giverId === user.id);
    const admirerId = assignments.find((a) => a.recipientId === user.id)?.giverId ?? null;

    const ids = [myOut?.recipientId, admirerId].filter(Boolean) as string[];
    const users = await db.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    const nameOf = (id: string | null | undefined) =>
      id ? users.find((u) => u.id === id)?.displayName ?? null : null;

    const myGuess = await db.guess.findUnique({
      where: { roundId_guesserId: { roundId: round.id, guesserId: user.id } },
    });
    const correct = !!(myGuess && admirerId && myGuess.guessedId === admirerId);

    const nextRound = await db.round.findFirst({
      where: { status: { in: ["draft", "registration_open"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, registrationStart: true, registrationEnd: true, status: true },
    });

    return Response.json({
      revealed: true,
      round: { id: round.id, name: round.name, status: round.status },
      admirer: { displayName: nameOf(admirerId) },
      friend: { displayName: nameOf(myOut?.recipientId) },
      guess: myGuess
        ? {
            guessedId: myGuess.guessedId,
            guessedName: nameOf(myGuess.guessedId),
            correct,
          }
        : null,
      isWinner: correct,
      nextRound,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
