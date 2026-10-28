import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { ensureBootstrap } from "@/lib/bootstrap";
import { tick, getSettings } from "@/lib/lifecycle";
import { whatsappStatus } from "@/lib/whatsapp";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    await ensureBootstrap();
    const tickResult = await tick();
    const settings = await getSettings();
    const now = new Date();

    const round = await db.round.findFirst({
      where: { status: { notIn: ["archived"] } },
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: {
            registrations: true,
            assignments: true,
            messages: true,
            guesses: true,
          },
        },
      },
    });

    const countsByCategory = round
      ? await Promise.all([
          db.registration.count({ where: { roundId: round.id, status: "ACTIVE", category: "A" } }),
          db.registration.count({ where: { roundId: round.id, status: "ACTIVE", category: "B" } }),
        ]).then(([A, B]) => ({ A, B }))
      : { A: 0, B: 0 };

    // PERFORMANCE: all dashboard counters are independent — one parallel
    // batch instead of ten sequential round-trips (polled every 15 s).
    const [unverified, pendingModeration, openReports, failedDeliveries, openResetRequests, totalMembers, totalMessages, revealedRounds] = round
      ? await Promise.all([
          db.registration.count({ where: { roundId: round.id, status: "ACTIVE", verificationStatus: "PENDING" } }),
          db.message.count({ where: { roundId: round.id, modStatus: { in: ["PENDING", "REVIEW"] } } }),
          db.moderationReport.count({ where: { roundId: round.id, status: "OPEN" } }),
          db.message.count({ where: { roundId: round.id, deliveryStatus: "FAILED" } }),
          db.passwordResetRequest.count({ where: { status: "OPEN" } }),
          db.user.count(),
          db.message.count(),
          db.round.count({ where: { status: { in: ["revealed", "archived"] } } }),
        ])
      : [0, 0, 0, 0, 0, await db.user.count(), 0, 0];

    const wa = whatsappStatus(settings.whatsappTestMode);
    void now;

    return Response.json({
      tick: tickResult,
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
            nextRoundRegistrationEnabled: round.nextRoundRegistrationEnabled,
            counts: {
              registrations: round._count.registrations,
              assignments: round._count.assignments,
              messages: round._count.messages,
              guesses: round._count.guesses,
            },
          }
        : null,
      countsByCategory,
      unverified,
      pendingModeration,
      openReports,
      failedDeliveries,
      openResetRequests,
      stats: { totalMembers, totalMessages, revealedRounds },
      integrations: {
        whatsapp: wa.configured ? "OPERATIONAL" : "NOT_CONFIGURED",
        whatsappTestMode: wa.testMode,
        aiModeration: settings.aiModerationEnabled ? "OPERATIONAL" : "FILTERS_ONLY",
        database: "OPERATIONAL",
        auth: "OPERATIONAL",
      },
    });
  } catch (e) {
    if (e instanceof Error && e.message === "FORBIDDEN") return jsonError("FORBIDDEN", 403);
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
