import { db } from "@/lib/db";
import { requireUser, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    const notifications = await db.notification.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const unread = await db.notification.count({ where: { userId: user.id, read: false } });
    return Response.json({ notifications, unread });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

export async function POST() {
  try {
    const user = await requireUser();
    await db.notification.updateMany({
      where: { userId: user.id, read: false },
      data: { read: true },
    });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && e.message === "UNAUTHENTICATED") return jsonError("UNAUTHENTICATED", 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
