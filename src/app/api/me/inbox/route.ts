import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — the member's two anonymous threads:
//  • "friend": I take care of them (my outgoing assignment)
//  • "admirer": they take care of me (my incoming assignment)
// Sender identity is NEVER exposed — only anonymous labels.
//
// PERFORMANCE (fix): this endpoint is polled every few seconds — it must
// never write to the database. Marking messages as read moved to the POST
// handler, which the client calls only when the message center is actually
// open and there is something unread.
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

    // PERFORMANCE: all independent lookups run concurrently (this endpoint is
    // polled every few seconds by the message center).
    const [myOut, myIn, myRegistration] = await Promise.all([
      db.assignment.findFirst({
        where: { roundId: round.id, giverId: user.id, status: "ACTIVE" },
        select: { recipientId: true },
      }),
      db.assignment.findFirst({
        where: { roundId: round.id, recipientId: user.id, status: "ACTIVE" },
        select: { giverId: true },
      }),
      db.registration.findUnique({
        where: { roundId_userId: { roundId: round.id, userId: user.id } },
        select: { status: true, verificationStatus: true },
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
        orderBy: { createdAt: "desc" },
        take: 100,
      });
      return msgs.reverse().map((m) => {
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

    const [friendThread, admirerThread] = await Promise.all([
      myOut ? loadThread(myOut.recipientId) : Promise.resolve([]),
      myIn ? loadThread(myIn.giverId) : Promise.resolve([]),
    ]);

    const canSend = round.status === "active" || round.status === "guessing_open";

    // UX: an explicit reason why sending is blocked, so the UI can explain
    // instead of showing a generic "no round" state.
    let sendBlockReason: string | null = null;
    if (!canSend) {
      sendBlockReason = revealed ? "REVEALED" : "ROUND_NOT_ACTIVE";
    } else if (!myOut && !myIn) {
      if (!myRegistration || myRegistration.status !== "ACTIVE") {
        sendBlockReason = "NOT_REGISTERED";
      } else if (myRegistration.verificationStatus !== "APPROVED") {
        sendBlockReason = "NOT_APPROVED";
      } else {
        sendBlockReason = "NO_ASSIGNMENT";
      }
    }

    return Response.json({
      round: { id: round.id, name: round.name, status: round.status, messageMaxLength: round.messageMaxLength },
      revealed,
      threads: {
        friend: { exists: !!myOut, messages: friendThread },
        admirer: { exists: !!myIn, messages: admirerThread },
      },
      canSend,
      sendBlockReason,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — mark the member's incoming messages as read. Called by the client
// ONLY when the message center is open and visible and there is something
// unread — never by the polling GET (was a DB write every 5 s per user).
export async function POST() {
  try {
    const user = await requireUser();
    const round = await db.round.findFirst({
      where: { status: { in: ["active", "guessing_open", "revealed", "archived"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!round) return Response.json({ ok: true, updated: 0 });
    const result = await db.message.updateMany({
      where: {
        roundId: round.id,
        recipientId: user.id,
        senderId: { not: user.id },
        modStatus: "ALLOWED",
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return Response.json({ ok: true, updated: result.count });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
