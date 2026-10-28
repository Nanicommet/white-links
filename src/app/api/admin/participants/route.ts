import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — participant management list for the active round
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const roundId = url.searchParams.get("roundId");
    const round = roundId
      ? await db.round.findUnique({ where: { id: roundId } })
      : await db.round.findFirst({ where: { status: { notIn: ["archived"] } }, orderBy: { createdAt: "desc" } });
    if (!round) return Response.json({ round: null, registrations: [], resetRequests: [] });

    const registrations = await db.registration.findMany({
      where: { roundId: round.id },
      include: {
        user: {
          select: { id: true, email: true, displayName: true, phone: true, phoneVerified: true, restrictedUntil: true, createdAt: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const resetRequests = await db.passwordResetRequest.findMany({
      where: { status: "OPEN" },
      include: { user: { select: { id: true, displayName: true, email: true } } },
      orderBy: { createdAt: "desc" },
    });

    return Response.json({
      round: { id: round.id, name: round.name, status: round.status },
      registrations: registrations.map((r) => ({
        id: r.id,
        displayName: r.user.displayName,
        email: r.user.email,
        phone: r.phone,
        phoneVerified: r.user.phoneVerified,
        category: r.category,
        interests: r.interests,
        giftPrefs: r.giftPrefs,
        status: r.status,
        verificationStatus: r.verificationStatus,
        restrictedUntil: r.user.restrictedUntil,
        createdAt: r.createdAt,
      })),
      resetRequests,
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
