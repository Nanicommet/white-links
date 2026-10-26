import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { tick } from "@/lib/lifecycle";
import { maskPhone } from "@/lib/phone";

export const runtime = "nodejs";

// GET — my registration for the current/most recent round
export async function GET() {
  try {
    const user = await requireUser();
    await tick();
    const round = await db.round.findFirst({
      where: { status: { in: ["registration_open", "registration_closed", "matching_pending", "active", "guessing_open", "revealed"] } },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return Response.json({ round: null, registration: null });
    const registration = await db.registration.findUnique({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    return Response.json({
      round: {
        id: round.id,
        name: round.name,
        status: round.status,
        registrationEnd: round.registrationEnd,
        matchingMode: round.matchingMode,
        isDemo: round.isDemo,
      },
      registration: registration
        ? {
            id: registration.id,
            category: registration.category,
            status: registration.status,
            verificationStatus: registration.verificationStatus,
            phoneMasked: maskPhone(registration.phone),
            interests: registration.interests,
            giftPrefs: registration.giftPrefs,
            canWithdraw:
              round.status === "registration_open" && registration.status === "ACTIVE",
          }
        : null,
    });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// DELETE — withdraw before assignments are finalized
export async function DELETE() {
  try {
    const user = await requireUser();
    const round = await db.round.findFirst({
      where: { status: "registration_open" },
      orderBy: { createdAt: "desc" },
    });
    if (!round) return jsonError("NO_OPEN_ROUND", 400);
    const registration = await db.registration.findUnique({
      where: { roundId_userId: { roundId: round.id, userId: user.id } },
    });
    if (!registration) return jsonError("NOT_REGISTERED", 404);
    if (registration.status !== "ACTIVE") return jsonError("ALREADY_WITHDRAWN", 400);
    // Withdrawals are only allowed while the round has not been matched
    if (round.status !== "registration_open") {
      return jsonError("WITHDRAWAL_CLOSED", 403);
    }
    await db.registration.update({
      where: { id: registration.id },
      data: { status: "WITHDRAWN" },
    });
    await audit(user.id, user.displayName, "REGISTRATION_WITHDRAWN", registration.id, {
      roundId: round.id,
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
