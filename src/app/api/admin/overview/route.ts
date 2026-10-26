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
      ? {
          A: await db.registration.count({ where: { roundId: round.id, status: "ACTIVE", category: "A" } }),
          B: await db.registration.count({ where: { roundId: round.id, status: "ACTIVE", category: "B" } }),
        }
      : { A: 0, B: 0 };

    const unverified = round
      ? await db.registration.count({ where: { roundId: round.id, status: "ACTIVE", verificationStatus: "PENDING" } })
      : 0;
    const pendingModeration = round
      ? await db.message.count({ where: { roundId: round.id, modStatus: { in: ["PENDING", "REVIEW"] } } })
      : 0;
    const openReports = round
      ? await db.moderationReport.count({ where: { roundId: round.id, status: "OPEN" } })
      : 0;
    const failedDeliveries = round
      ? await db.message.count({ where: { roundId: round.id, deliveryStatus: "FAILED" } })
      : 0;
    const openResetRequests = await db.passwordResetRequest.count({ where: { status: "OPEN" } });
    const totalMembers = await db.user.count();
    const totalMessages = await db.message.count();
    const revealedRounds = await db.round.count({ where: { status: { in: ["revealed", "archived"] } } });

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
