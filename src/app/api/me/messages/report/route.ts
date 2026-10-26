import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// POST — report a message to the club's moderators
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { messageId, reason } = (await req.json()) as { messageId?: string; reason?: string };
    if (!messageId || !reason || reason.trim().length < 3) {
      return jsonError("INVALID_REPORT", 400);
    }
    const message = await db.message.findUnique({ where: { id: messageId } });
    if (!message) return jsonError("MESSAGE_NOT_FOUND", 404);
    // Only a conversation participant may report that conversation's messages
    if (message.senderId !== user.id && message.recipientId !== user.id) {
      return jsonError("FORBIDDEN", 403);
    }
    const round = await db.round.findUnique({ where: { id: message.roundId } });
    if (!round) return jsonError("ROUND_NOT_FOUND", 404);

    const report = await db.moderationReport.create({
      data: {
        roundId: round.id,
        reporterId: user.id,
        messageId,
        reason: reason.trim().slice(0, 500),
        status: "OPEN",
      },
    });
    await db.message.update({ where: { id: messageId }, data: { reported: true } });
    await audit(user.id, user.displayName, "MESSAGE_REPORTED", messageId, { reportId: report.id });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
