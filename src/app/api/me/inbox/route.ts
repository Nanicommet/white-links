import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — the member's two anonymous threads:
//  • "friend": I take care of them (my outgoing assignment)
//  • "admirer": they take care of me (my incoming assignment)
// Sender identity is NEVER exposed — only anonymous labels.
export async function GET() {
  try {
    const user = await requireUser();
    const round = await db.round.findFirst({
      where: { status: { in: ["active", "guessing_open", "revealed", "archived"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return Response.json({ threads: null, round: null });
    const revealed = round.status === "revealed" || round.status === "archived";

    const myOut = await db.assignment.findFirst({
      where: { roundId: round.id, giverId: user.id, status: "ACTIVE" },
      select: { recipientId: true },
    });
    const myIn = await db.assignment.findFirst({
      where: { roundId: round.id, recipientId: user.id, status: "ACTIVE" },
      select: { giverId: true },
    });

    async function loadThread(otherId: string | undefined | null) {
      if (!otherId) return [];
      const msgs = await db.message.findMany({
        where: {
          roundId: round.id,
          OR: [
            { senderId: user.id, recipientId: otherId },
            { senderId: otherId, recipientId: user.id },
          ],
          modStatus: { in: ["ALLOWED", "REJECTED", "REVIEW"] },
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return msgs.map((m) => ({
        id: m.id,
        mine: m.senderId === user.id,
        body: m.body,
        createdAt: m.createdAt,
        readAt: m.readAt,
        modStatus: m.mine ? m.modStatus : "ALLOWED", // recipients never see moderation internals
        modExplanation: m.mine ? m.modExplanation : null,
        deliveryStatus: m.mine ? m.deliveryStatus : null,
      }));
    }

    const friendThread = myOut ? await loadThread(myOut.recipientId) : [];
    const admirerThread = myIn ? await loadThread(myIn.giverId) : [];

    // Mark incoming allowed messages as read
    await db.message.updateMany({
      where: {
        roundId: round.id,
        recipientId: user.id,
        senderId: { not: user.id },
        modStatus: "ALLOWED",
        readAt: null,
      },
      data: { readAt: new Date() },
    });

    return Response.json({
      round: { id: round.id, name: round.name, status: round.status, isDemo: round.isDemo, messageMaxLength: round.messageMaxLength },
      revealed,
      threads: {
        friend: { exists: !!myOut, messages: friendThread },
        admirer: { exists: !!myIn, messages: admirerThread },
      },
      canSend: round.status === "active" || round.status === "guessing_open",
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
