import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { tick, getSettings } from "@/lib/lifecycle";
import { missionForDay } from "@/lib/missions";

export const runtime = "nodejs";

// GET — everything the member's dashboard needs, scoped & safe.
// NEVER includes the admirer's identity, assignment IDs, or phones.
export async function GET() {
  try {
    const user = await requireUser();
    // PERFORMANCE: settings, lifecycle tick and the round lookup are
    // independent — run them concurrently instead of back-to-back.
    const [, settings, round] = await Promise.all([
      tick(),
      getSettings(),
      db.round.findFirst({
        where: { status: { in: ["registration_open", "registration_closed", "matching_pending", "active", "guessing_open", "revealed"] } },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    if (!round) return Response.json({ phase: "NO_ROUND" });

    // PERFORMANCE: registration + both unread counters are independent.
    // (unread === admirerUnread: a message addressed to me can only come
    // from my secret admirer — one COUNT serves both payload fields.)
    const [registration, unread, notificationsUnread] = await Promise.all([
      db.registration.findUnique({
        where: { roundId_userId: { roundId: round.id, userId: user.id } },
      }),
      db.message.count({
        where: {
          roundId: round.id,
          recipientId: user.id,
          modStatus: "ALLOWED",
          readAt: null,
          senderId: { not: user.id },
        },
      }),
      db.notification.count({ where: { userId: user.id, read: false } }),
    ]);
    if (!registration || registration.status !== "ACTIVE") {
      return Response.json({ phase: "NOT_REGISTERED", round: { id: round.id, name: round.name, status: round.status, registrationEnd: round.registrationEnd, matchingMode: round.matchingMode } });
    }

    // Day index for the daily mission
    let dayIndex = 0;
    let mission: { fr: string; ar: string; icon: string } | null = null;
    if (round.gameStart && (round.status === "active" || round.status === "guessing_open")) {
      const elapsed = Date.now() - round.gameStart.getTime();
      dayIndex = Math.max(0, Math.floor(elapsed / (24 * 3600 * 1000)));
      if (round.missionsEnabled && settings.missionsEnabled) {
        mission = missionForDay(round.gameStart, dayIndex);
      }
    }

    // ── Phase-specific payloads ──
    if (round.status === "active" || round.status === "guessing_open") {
      // Outgoing assignment: who I take care of (permitted info only)
      const assignment = await db.assignment.findFirst({
        where: { roundId: round.id, giverId: user.id, status: "ACTIVE" },
        include: {
          recipient: {
            include: {
              registrations: {
                where: { roundId: round.id },
                select: { interests: true, giftPrefs: true },
              },
            },
          },
        },
      });

      return Response.json({
        phase: "PLAYING",
        round: {
          id: round.id,
          name: round.name,
          status: round.status,
          gameStart: round.gameStart,
          gameEnd: round.gameEnd,
          guessingStart: round.guessingStart,
          guessingDeadline: round.guessingDeadline,
          revealAt: round.revealAt,
          messageMaxLength: round.messageMaxLength,
        },
        friend: assignment
          ? {
              displayName: assignment.recipient.displayName,
              interests: assignment.recipient.registrations[0]?.interests ?? null,
              giftPrefs: assignment.recipient.registrations[0]?.giftPrefs ?? null,
            }
          : null,
        unread,
        admirerUnread: unread,
        notificationsUnread,
        mission,
        dayIndex,
        totalDays: settings.gameDays,
        verified: registration.verificationStatus === "APPROVED",
      });
    }

    if (round.status === "revealed" || round.status === "archived") {
      // PERFORMANCE: assignments, guess and next-round lookups are independent.
      const [assignments, myGuess, nextRound] = await Promise.all([
        db.assignment.findMany({
          where: { roundId: round.id, status: "ACTIVE" },
          select: { giverId: true, recipientId: true },
        }),
        db.guess.findUnique({
          where: { roundId_guesserId: { roundId: round.id, guesserId: user.id } },
        }),
        db.round.findFirst({
          where: { status: { in: ["draft", "registration_open"] } },
          orderBy: { createdAt: "desc" },
          select: { id: true, name: true, registrationStart: true, status: true },
        }),
      ]);
      const myOut = assignments.find((a) => a.giverId === user.id);
      const myAdmirerId = assignments.find((a) => a.recipientId === user.id)?.giverId ?? null;
      const [friend, admirer] = await Promise.all([
        myOut ? db.user.findUnique({ where: { id: myOut.recipientId }, select: { displayName: true } }) : null,
        myAdmirerId ? db.user.findUnique({ where: { id: myAdmirerId }, select: { displayName: true } }) : null,
      ]);
      const correct = !!(myGuess && myAdmirerId && myGuess.guessedId === myAdmirerId);
      return Response.json({
        phase: "REVEALED",
        friend: friend ? { displayName: friend.displayName } : null,
        admirer: admirer ? { displayName: admirer.displayName } : null,
        guess: myGuess ? { guessedId: myGuess.guessedId, correct } : null,
        isWinner: correct,
        notificationsUnread,
        unread,
        nextRound,
      });
    }

    // Registration / closed / matching phases
    return Response.json({
      phase: "WAITING",
      round: {
        id: round.id,
        name: round.name,
        status: round.status,
        registrationEnd: round.registrationEnd,
        matchingMode: round.matchingMode,
      },
      registration: {
        category: registration.category,
        verificationStatus: registration.verificationStatus,
      },
      notificationsUnread,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
