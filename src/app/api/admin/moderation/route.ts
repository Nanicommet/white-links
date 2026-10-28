import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";

export const runtime = "nodejs";

// GET — moderation queue: messages in REVIEW/PENDING + open reports
export async function GET() {
  try {
    await requireAdmin();
    const reviewMessages = await db.message.findMany({
      where: { modStatus: { in: ["REVIEW", "PENDING"] } },
      include: { sender: { select: { displayName: true } }, round: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const reports = await db.moderationReport.findMany({
      where: { status: "OPEN" },
      include: {
        reporter: { select: { displayName: true } },
        round: { select: { name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
    });
    const reportMessages = await db.message.findMany({
      where: { id: { in: reports.map((r) => r.messageId).filter(Boolean) as string[] } },
    });
    return Response.json({
      reviewMessages: reviewMessages.map((m) => ({
        id: m.id,
        body: m.body,
        senderName: m.sender.displayName,
        roundName: m.round.name,
        modStatus: m.modStatus,
        modReason: m.modReason,
        modExplanation: m.modExplanation,
        createdAt: m.createdAt,
      })),
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        reporterName: r.reporter.displayName,
        roundName: r.round.name,
        message: reportMessages.find((m) => m.id === r.messageId)
          ? { id: r.messageId, body: reportMessages.find((m) => m.id === r.messageId)!.body }
          : null,
        createdAt: r.createdAt,
      })),
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — resolve a review message or a report
// body: { type: "message" | "report", id, decision: "allow" | "reject" | "dismiss" }
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { type, id, decision } = (await req.json()) as {
      type?: string;
      id?: string;
      decision?: string;
    };
    if (!type || !id || !decision) return jsonError("MISSING_FIELDS", 400);

    if (type === "message") {
      const message = await db.message.findUnique({ where: { id } });
      if (!message) return jsonError("MESSAGE_NOT_FOUND", 404);
      if (decision === "allow") {
        await db.message.update({
          where: { id },
          data: { modStatus: "ALLOWED", modSource: "ADMIN", modExplanation: "Validé par un modérateur du club." },
        });
        await audit(admin.id, admin.displayName, "MODERATION_ALLOW", id, null);
      } else if (decision === "reject") {
        await db.message.update({
          where: { id },
          data: { modStatus: "REJECTED", modSource: "ADMIN", modExplanation: "Refusé après vérification par un modérateur du club." },
        });
        await notify({
          userId: message.senderId,
          roundId: message.roundId,
          type: "MODERATION_REJECTED",
          title: "Message non transmis 🚫",
          body: "Ton message a été vérifié par un modérateur et n'a pas été transmis. Merci de garder des messages bienveillants.",
          dedupeKey: `mod-admin:${message.id}`,
        });
        await audit(admin.id, admin.displayName, "MODERATION_REJECT", id, null);
      } else {
        return jsonError("INVALID_DECISION", 400);
      }
      return Response.json({ ok: true });
    }

    if (type === "report") {
      const report = await db.moderationReport.findUnique({ where: { id } });
      if (!report) return jsonError("REPORT_NOT_FOUND", 404);
      if (decision === "dismiss") {
        await db.moderationReport.update({
          where: { id },
          data: { status: "RESOLVED", resolution: "Rejeté sans suite", resolvedBy: admin.displayName, resolvedAt: new Date() },
        });
      } else if (decision === "remove_message") {
        if (report.messageId) {
          await db.message.update({
            where: { id: report.messageId },
            data: { modStatus: "REJECTED", modSource: "ADMIN", modExplanation: "Retiré suite à un signalement." },
          });
        }
        await db.moderationReport.update({
          where: { id },
          data: { status: "RESOLVED", resolution: "Message retiré", resolvedBy: admin.displayName, resolvedAt: new Date() },
        });
      } else {
        return jsonError("INVALID_DECISION", 400);
      }
      await audit(admin.id, admin.displayName, `REPORT_${decision.toUpperCase()}`, id, null);
      return Response.json({ ok: true });
    }

    return jsonError("INVALID_TYPE", 400);
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
