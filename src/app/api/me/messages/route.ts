import { requireUser, jsonError } from "@/lib/auth";
import { sendMemberMessage } from "@/lib/messaging";

export const runtime = "nodejs";

// POST — send an anonymous message from the web message center.
// body: { destination: "friend" | "admirer", body: string }
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const payload = (await req.json()) as { destination?: string; body?: string };
    if (payload.destination !== "friend" && payload.destination !== "admirer") {
      return jsonError("INVALID_DESTINATION", 400);
    }
    if (!payload.body || typeof payload.body !== "string") {
      return jsonError("EMPTY_BODY", 400);
    }
    const outcome = await sendMemberMessage({
      senderId: user.id,
      destination: payload.destination,
      body: payload.body,
      source: "WEB",
    });
    if (!outcome.ok) {
      return Response.json(
        {
          error: outcome.error ?? "SEND_FAILED",
          message: outcome.message,
          modStatus: outcome.modStatus,
          modExplanation: outcome.modExplanation,
        },
        { status: outcome.error === "RATE_LIMITED" ? 429 : outcome.error === "REJECTED_BY_MODERATION" ? 422 : 400 }
      );
    }
    return Response.json({ ok: true, modStatus: outcome.modStatus, deliveryStatus: outcome.deliveryStatus });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
