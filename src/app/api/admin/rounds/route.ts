import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { tick } from "@/lib/lifecycle";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    await tick();
    const rounds = await db.round.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { registrations: true, assignments: true, messages: true, guesses: true } } },
    });
    return Response.json({ rounds });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

const createSchema = z.object({
  name: z.string().trim().min(3).max(80),
  registrationStart: z.string().datetime(),
  registrationEnd: z.string().datetime(),
  matchingMode: z.enum(["OPEN", "CROSS_CATEGORY"]),
});

export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) return jsonError("VALIDATION", 400, { issues: parsed.error.issues.map((i) => i.path.join(".")) });
    const { name, registrationStart, registrationEnd, matchingMode } = parsed.data;
    const start = new Date(registrationStart);
    const end = new Date(registrationEnd);
    if (end <= start) return jsonError("INVALID_DATES", 400);

    const round = await db.round.create({
      data: { name, registrationStart: start, registrationEnd: end, matchingMode, status: "draft" },
    });
    await audit(admin.id, admin.displayName, "ROUND_CREATED", round.id, { name, matchingMode });
    return Response.json({ ok: true, round });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
