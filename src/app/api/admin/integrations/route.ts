import { db } from "@/lib/db";
import { requireAdmin, jsonError } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { whatsappStatus, sendWhatsAppText } from "@/lib/whatsapp";
import { getSettings } from "@/lib/lifecycle";

export const runtime = "nodejs";

// GET — integration health with honest statuses + setup instructions
export async function GET() {
  try {
    await requireAdmin();
    const settings = await getSettings();
    const wa = whatsappStatus(settings.whatsappTestMode);
    const jobCount = await db.jobLog.count();
    const lastJob = await db.jobLog.findFirst({ orderBy: { createdAt: "desc" } });
    return Response.json({
      integrations: [
        {
          id: "database",
          name: "Base de données (SQLite + Prisma)",
          status: "OPERATIONAL",
          detail: "Base locale opérationnelle.",
        },
        {
          id: "auth",
          name: "Authentification (sessions signées HMAC)",
          status: "OPERATIONAL",
          detail: "Sessions cookie httpOnly, mots de passe scrypt.",
        },
        {
          id: "ai",
          name: "Modération IA",
          status: settings.aiModerationEnabled ? "OPERATIONAL" : "FILTERS_ONLY",
          detail: settings.aiModerationEnabled
            ? "Filtres déterministes + classification IA (z-ai-web-dev-sdk)."
            : "Seuls les filtres déterministes sont actifs.",
          env: ["— (SDK intégré — aucune clé requise)"],
        },
        {
          id: "whatsapp",
          name: "WhatsApp Business Platform (Cloud API)",
          status: wa.configured ? "OPERATIONAL" : "NOT_CONFIGURED",
          detail: wa.configured
            ? wa.testMode
              ? "Configuré — MODE TEST activé (aucun message réel)."
              : "Configuré et actif."
            : "Configuration requise.",
          missing: wa.missing,
          env: [
            "WHATSAPP_ACCESS_TOKEN",
            "WHATSAPP_PHONE_NUMBER_ID",
            "WHATSAPP_VERIFY_TOKEN",
            "WHATSAPP_APP_SECRET",
            "WHATSAPP_API_VERSION (optionnel)",
          ],
          webhookUrl: "/api/webhooks/whatsapp (GET verify + POST events)",
        },
        {
          id: "jobs",
          name: "Tâches planifiées (cycle de vie)",
          status: "OPERATIONAL",
          detail: `Transitions automatiques idempotentes à chaque requête (${jobCount} exécutions).`,
          lastRun: lastJob?.createdAt ?? null,
        },
        {
          id: "delivery",
          name: "Envoi de messages",
          status: wa.configured ? "OPERATIONAL" : "PARTIAL",
          detail: wa.configured
            ? "Livraison WhatsApp + boîte de réception web."
            : "Boîte de réception web uniquement — les statuts restent honnêtes (jamais de faux « envoyé »).",
        },
      ],
    });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}

// POST — send a test message (only meaningful when configured; otherwise
// returns an explicit NOT_CONFIGURED response, never fake success)
export async function POST(req: Request) {
  try {
    const admin = await requireAdmin();
    const { phone } = (await req.json()) as { phone?: string };
    const settings = await getSettings();
    const wa = whatsappStatus(settings.whatsappTestMode);
    if (!wa.configured) {
      return Response.json({ ok: false, status: "NOT_CONFIGURED", missing: wa.missing });
    }
    const result = await sendWhatsAppText(phone ?? "+21600000000", "🧪 Message de test WHITE LINKS — l'intégration WhatsApp fonctionne.");
    await audit(admin.id, admin.displayName, "WHATSAPP_TEST", null, { ok: result.ok, simulated: result.simulated ?? false });
    return Response.json({ ok: result.ok, status: result.ok ? (result.simulated ? "SIMULATED" : "SENT") : "FAILED", error: result.error });
  } catch (e) {
    if (e instanceof Error && (e.message === "FORBIDDEN" || e.message === "UNAUTHENTICATED")) return jsonError(e.message, e.message === "FORBIDDEN" ? 403 : 401);
    return jsonError("SERVER_ERROR", 500);
  }
}
