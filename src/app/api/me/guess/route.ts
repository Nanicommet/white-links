import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { tick } from "@/lib/lifecycle";

export const runtime = "nodejs";

// GET — guess state + eligible participant list (names only)
export async function GET() {
  try {
    const user = await requireUser();
    await tick();
    const round = await db.round.findFirst({
      where: { status: { in: ["active", "guessing_open", "revealed"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return Response.json({ open: false, reason: "NO_ROUND" });

    const registration = await db.registration.findUnique({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    if (!registration || registration.status !== "ACTIVE") {
      return Response.json({ open: false, reason: "NOT_REGISTERED" });
    }

    const now = new Date();
    const isOpen =
      round.status === "guessing_open" && (!round.guessingDeadline || now < round.guessingDeadline);

    if (round.status === "revealed" || round.status === "archived") {
      return Response.json({ open: false, reason: "REVEALED", round: { id: round.id, status: round.status } });
    }

    // PRIVACY: the participant roster is only needed (and only returned)
    // while the guessing window is actually open — not before.
    const participants = isOpen
      ? await db.registration.findMany({
          where: { roundId: round.id, status: "ACTIVE", verificationStatus: "APPROVED" },
          include: { user: { select: { id: true, displayName: true } } },
        })
      : [];

    const myGuess = await db.guess.findUnique({
      where: { roundId_guesserId: { roundId: round.id, guesserId: user.id } },
    });

    return Response.json({
      open: isOpen,
      deadline: round.guessingDeadline,
      round: { id: round.id, name: round.name, status: round.status },
      participants: participants.map((p) => ({
        id: p.userId,
        displayName: p.user.displayName,
        isMe: p.userId === user.id,
      })),
      myGuess: myGuess ? { guessedId: myGuess.guessedId } : null,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — submit/update the guess. Only latest guess counts; changes are
// allowed only while the guessing window is open (server-validated).
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { guessedId } = (await req.json()) as { guessedId?: string };
    if (!guessedId) return jsonError("MISSING_GUESS", 400);

    const round = await db.round.findFirst({
      where: { status: { in: ["active", "guessing_open"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return jsonError("NO_ROUND", 400);
    const now = new Date();
    // Hard server-side deadline enforcement (acceptance test #14)
    if (round.status !== "guessing_open" || !round.guessingStart || now < round.guessingStart) {
      return jsonError("GUESSING_NOT_OPEN", 403);
    }
    if (round.guessingDeadline && now >= round.guessingDeadline) {
      return jsonError("GUESSING_CLOSED", 403);
    }

    const registration = await db.registration.findUnique({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    if (!registration || registration.status !== "ACTIVE" || registration.verificationStatus !== "APPROVED") {
      return jsonError("NOT_ELIGIBLE", 403);
    }

    // Cannot guess yourself; target must be an eligible participant
    if (guessedId === user.id) return jsonError("CANNOT_GUESS_SELF", 400);
    const target = await db.registration.findFirst({
      where: { roundId: round.id, userId: guessedId, status: "ACTIVE", verificationStatus: "APPROVED" },
    });
    if (!target) return jsonError("INVALID_TARGET", 400);

    const existing = await db.guess.findUnique({
      where: { roundId_guesserId: { roundId: round.id, guesserId: user.id } },
    });
    if (existing) {
      await db.guess.update({
        where: { id: existing.id },
        data: { guessedId, updatedAt: now },
      });
    } else {
      await db.guess.create({
        data: { roundId: round.id, guesserId: user.id, guessedId },
      });
    }
    await audit(user.id, user.displayName, "GUESS_SUBMITTED", round.id, null);
    return Response.json({ ok: true, locked: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
