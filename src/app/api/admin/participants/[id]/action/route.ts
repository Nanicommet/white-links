import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { generateTempPassword, hashPassword } from "@/lib/phone";

export const runtime = "nodejs";

// POST — participant actions: approve | reject | remove | restrict |
//        unrestrict | reset_password
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await params; // registration id
    const { action } = (await req.json()) as { action?: string };
    if (!action) return jsonError("MISSING_ACTION", 400);

    const registration = await db.registration.findUnique({
      where: { id },
      include: { user: true, round: true },
    });
    if (!registration) return jsonError("REGISTRATION_NOT_FOUND", 404);

    switch (action) {
      case "approve": {
        if (registration.verificationStatus !== "PENDING") return jsonError("NOT_PENDING", 400);
        await db.registration.update({
          where: { id },
          data: { verificationStatus: "APPROVED" },
        });
        await db.user.update({ where: { id: registration.userId }, data: { phoneVerified: true } });
        await audit(admin.id, admin.displayName, "PARTICIPANT_APPROVED", id, { phone: registration.phone });
        return Response.json({ ok: true });
      }
      case "reject": {
        if (registration.verificationStatus !== "PENDING") return jsonError("NOT_PENDING", 400);
        await db.registration.update({
          where: { id },
          data: { verificationStatus: "REJECTED", status: "REMOVED" },
        });
        await audit(admin.id, admin.displayName, "PARTICIPANT_REJECTED", id, { phone: registration.phone });
        return Response.json({ ok: true });
      }
      case "remove": {
        // Removes from the current round (duplicate or invalid registration)
        if (["active", "guessing_open"].includes(registration.round.status)) {
          return jsonError("ROUND_ACTIVE_USE_REPAIR", 403);
        }
        await db.registration.update({ where: { id }, data: { status: "REMOVED" } });
        await audit(admin.id, admin.displayName, "PARTICIPANT_REMOVED", id, { roundId: registration.roundId });
        return Response.json({ ok: true });
      }
      case "restrict": {
        const days = 7;
        await db.user.update({
          where: { id: registration.userId },
          data: { restrictedUntil: new Date(Date.now() + days * 24 * 3600 * 1000) },
        });
        await audit(admin.id, admin.displayName, "PARTICIPANT_RESTRICTED", registration.userId, { days });
        return Response.json({ ok: true });
      }
      case "unrestrict": {
        await db.user.update({
          where: { id: registration.userId },
          data: { restrictedUntil: null },
        });
        await audit(admin.id, admin.displayName, "PARTICIPANT_UNRESTRICTED", registration.userId, null);
        return Response.json({ ok: true });
      }
      case "reset_password": {
        const temp = generateTempPassword();
        await db.user.update({
          where: { id: registration.userId },
          data: { passwordHash: hashPassword(temp) },
        });
        // Resolve any open reset request
        await db.passwordResetRequest.updateMany({
          where: { userId: registration.userId, status: "OPEN" },
          data: { status: "DONE", resolvedAt: new Date() },
        });
        await audit(admin.id, admin.displayName, "PASSWORD_RESET", registration.userId, null);
        return Response.json({ ok: true, tempPassword: temp });
      }
      default:
        return jsonError("UNKNOWN_ACTION", 400);
    }
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
