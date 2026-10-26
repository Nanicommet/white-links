import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";

export const runtime = "nodejs";

// GET — audit log (sensitive administrative actions)
export async function GET(req: Request) {
  try {
    await requireAdmin();
    const url = new URL(req.url);
    const take = Math.min(parseInt(url.searchParams.get("take") ?? "100", 10), 200);
    const logs = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
    });
    return Response.json({ logs });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
