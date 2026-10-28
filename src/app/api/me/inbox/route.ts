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
    const roundId = round.id;

    // PERFORMANCE: both assignment lookups run concurrently (this endpoint is
    // polled every few seconds by the message center).
    const [myOut, myIn] = await Promise.all([
      db.assignment.findFirst({
        where: { roundId: round.id, giverId: user.id, status: "ACTIVE" },
        select: { recipientId: true },
      }),
      db.assignment.findFirst({
        where: { roundId: round.id, recipientId: user.id, status: "ACTIVE" },
        select: { giverId: true },
      }),
    ]);

    async function loadThread(otherId: string | undefined | null) {
      if (!otherId) return [];
      // PRIVACY/SAFETY: the two directions have different visibility rules.
      //  • My own messages: all moderation states (I may see my REJECTED
      //    messages with the moderator's explanation).
      //  • Incoming messages: ONLY "ALLOWED" — rejected or pending-review
      //    messages must never reach the recipient, even with a masked
      //    status label (this closed a moderation bypass).
      const msgs = await db.message.findMany({
        where: {
          roundId,
          OR: [
            { senderId: user.id, recipientId: otherId },
            { senderId: otherId, recipientId: user.id, modStatus: "ALLOWED" },
          ],
        },
        orderBy: { createdAt: "asc" },
        take: 200,
      });
      return msgs.map((m) => {
        const mine = m.senderId === user.id;
        return {
          id: m.id,
          mine,
          body: m.body,
          createdAt: m.createdAt,
          readAt: m.readAt,
          modStatus: mine ? m.modStatus : "ALLOWED", // recipients never see moderation internals
          modExplanation: mine ? m.modExplanation : null,
          deliveryStatus: mine ? m.deliveryStatus : null,
        };
      });
    }

    // PERFORMANCE: both threads + the mark-read update run concurrently.
    // (Marking read in parallel is safe: a message returned with readAt=null
    // simply shows its unread badge until the next poll, as before.)
    const [friendThread, admirerThread] = await Promise.all([
      myOut ? loadThread(myOut.recipientId) : Promise.resolve([]),
      myIn ? loadThread(myIn.giverId) : Promise.resolve([]),
      db.message.updateMany({
        where: {
          roundId,
          recipientId: user.id,
          senderId: { not: user.id },
          modStatus: "ALLOWED",
          readAt: null,
        },
        data: { readAt: new Date() },
      }),
    ]);

    return Response.json({
      round: { id: round.id, name: round.name, status: round.status, messageMaxLength: round.messageMaxLength },
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
