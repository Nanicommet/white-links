import { requireAdmin, jsonError } from "@/lib/auth";
import { seedDemo } from "@/lib/demo";
import { audit } from "@/lib/audit";

export const runtime = "nodejs";

// POST — generate demo data (demo environment only, clearly labelled)
export async function POST() {
  try {
    const admin = await requireAdmin();
    const result = await seedDemo();
    await audit(admin.id, admin.displayName, "DEMO_SEED_REQUESTED", result.roundId ?? null, {
      ok: result.ok,
    });
    return Response.json(result);
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
