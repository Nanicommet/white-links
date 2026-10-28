import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { getSettings, invalidateSettingsCache } from "@/lib/lifecycle";
import { z } from "zod";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireAdmin();
    const settings = await getSettings();
    const { authSecret, ...rest } = settings;
    void authSecret; // never exposed
    return Response.json({ settings: rest });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

const schema = z.object({
  registrationHours: z.number().int().min(1).max(168).optional(),
  gameDays: z.number().int().min(1).max(60).optional(),
  guessingHours: z.number().int().min(1).max(72).optional(),
  messageMaxLength: z.number().int().min(50).max(2000).optional(),
  messageRatePerHour: z.number().int().min(1).max(60).optional(),
  minParticipants: z.number().int().min(4).max(500).optional(),
  missionsEnabled: z.boolean().optional(),
  autoTransitions: z.boolean().optional(),
  aiModerationEnabled: z.boolean().optional(),
  whatsappTestMode: z.boolean().optional(),
  retentionDays: z.number().int().min(7).max(3650).optional(),
  categoryALabel: z.string().trim().min(1).max(30).optional(),
  categoryBLabel: z.string().trim().min(1).max(30).optional(),
  reminderCloseHours: z.number().int().min(1).max(48).optional(),
});

export async function PUT(req: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) return jsonError("VALIDATION", 400);
    await db.settings.upsert({
      where: { id: "global" },
      update: parsed.data,
      create: { id: "global", ...parsed.data },
    });
    invalidateSettingsCache(); // apply changes immediately (30s cache bypass)
    await audit(admin.id, admin.displayName, "SETTINGS_UPDATED", null, parsed.data);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
