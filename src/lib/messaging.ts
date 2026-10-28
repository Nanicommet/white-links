import { db } from "@/lib/db";
import { moderateMessage } from "@/lib/moderation";
import { getSettings } from "@/lib/lifecycle";
import { notify } from "@/lib/notify";
import { sendWhatsAppText, whatsappStatus, wrapAnonymously } from "@/lib/whatsapp";
import { CMD_TO_ADMIRER, CMD_TO_FRIEND } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// Message pipeline (web + WhatsApp inbound)
// Server-side routing only. Never exposes sender identity.
// ─────────────────────────────────────────────────────────────────

export type Destination = "friend" | "admirer";

export interface SendContext {
  senderId: string;
  destination: Destination;
  body: string;
  source: "WEB" | "WHATSAPP";
}

export interface SendOutcome {
  ok: boolean;
  error?: string; // machine-readable
  message?: string; // human-safe (fr)
  modStatus?: string;
  modExplanation?: string;
  deliveryStatus?: string;
}

async function currentActiveMembership(senderId: string) {
  const round = await db.round.findFirst({
    where: { status: { in: ["active", "guessing_open"] } },
    orderBy: { createdAt: "desc" },
  });
  if (!round) return null;
  const reg = await db.registration.findFirst({
    where: { roundId: round.id, userId: senderId, status: "ACTIVE", verificationStatus: "APPROVED" },
  });
  if (!reg) return null;
  return { round, reg };
}

async function resolveRecipient(
  senderId: string,
  roundId: string,
  destination: Destination
): Promise<string | null> {
  if (destination === "friend") {
    const a = await db.assignment.findFirst({
      where: { roundId, giverId: senderId, status: "ACTIVE" },
    });
    return a?.recipientId ?? null;
  }
  const a = await db.assignment.findFirst({
    where: { roundId, recipientId: senderId, status: "ACTIVE" },
  });
  return a?.giverId ?? null;
}

export async function sendMemberMessage(ctx: SendContext): Promise<SendOutcome> {
  const body = ctx.body.trim();
  if (!body) return { ok: false, error: "EMPTY", message: "Le message est vide." };

  // PERFORMANCE: settings (cached), membership, rate-limit counter and the
  // sender lookup are independent — one parallel batch keeps sending snappy.
  const hourAgo = new Date(Date.now() - 3600 * 1000);
  const [settings, membership, recent, sender] = await Promise.all([
    getSettings(),
    currentActiveMembership(ctx.senderId),
    db.message.count({
      where: { senderId: ctx.senderId, createdAt: { gte: hourAgo }, modStatus: { in: ["ALLOWED", "PENDING", "REVIEW"] } },
    }),
    db.user.findUnique({ where: { id: ctx.senderId } }),
  ]);

  if (body.length > settings.messageMaxLength) {
    return {
      ok: false,
      error: "TOO_LONG",
      message: `Message trop long (maximum ${settings.messageMaxLength} caractères).`,
    };
  }

  if (!membership) {
    return {
      ok: false,
      error: "NOT_ELIGIBLE",
      message: "Tu n'es pas éligible à la messagerie pour cette manche.",
    };
  }
  const { round } = membership;

  // Flood / rate limiting (server-side)
  if (recent >= settings.messageRatePerHour) {
    return { ok: false, error: "RATE_LIMITED", message: "Trop de messages envoyés cette heure-ci. Réessaie plus tard." };
  }

  // Restricted participant?
  if (sender?.restrictedUntil && sender.restrictedUntil > new Date()) {
    return {
      ok: false,
      error: "RESTRICTED",
      message: "Ta messagerie est restreinte par un modérateur. Contacte le club.",
    };
  }

  const recipientId = await resolveRecipient(ctx.senderId, round.id, ctx.destination);
  if (!recipientId) {
    return { ok: false, error: "NO_ASSIGNMENT", message: "Aucune attribution pour cette destination." };
  }

  // ── Moderation pipeline ──
  // Club policy: no human approval. Deterministic filters + (optional) AI
  // either allow or reject — messages are never parked in a review queue.
  const verdict = await moderateMessage(body, { aiEnabled: settings.aiModerationEnabled });
  const modStatus = verdict.decision === "reject" ? "REJECTED" : "ALLOWED";

  const message = await db.message.create({
    data: {
      roundId: round.id,
      senderId: ctx.senderId,
      recipientId,
      body,
      source: ctx.source,
      modStatus,
      modReason: verdict.reasonCode,
      modExplanation: verdict.safeExplanation,
      modConfidence: verdict.confidence,
      modSource: verdict.source,
      deliveryStatus: "QUEUED",
    },
  });

  if (modStatus !== "ALLOWED") {
    await notify({
      userId: ctx.senderId,
      roundId: round.id,
      type: "MODERATION_REJECTED",
      title: "Message non transmis 🚫",
      body: verdict.safeExplanation,
      dedupeKey: `mod:${message.id}`,
    });
    return {
      ok: false,
      error: "REJECTED_BY_MODERATION",
      message: verdict.safeExplanation,
      modStatus,
      modExplanation: verdict.safeExplanation,
      deliveryStatus: "QUEUED",
    };
  }

  // ── Delivery ──
  let deliveryStatus = "SENT"; // in-app delivery always works
  let providerMessageId: string | null = null;

  if (ctx.source === "WHATSAPP") {
    // Forward via WhatsApp with anonymity-preserving wrapper
    const wa = whatsappStatus(settings.whatsappTestMode);
    const recipientUser = await db.user.findUnique({ where: { id: recipientId } });
    const wrapped = wrapAnonymously(body, ctx.destination === "admirer");
    if (!wa.configured) {
      deliveryStatus = "NOT_CONFIGURED";
    } else {
      const result = await sendWhatsAppText(recipientUser!.phone, wrapped, { testMode: settings.whatsappTestMode });
      if (result.ok) {
        deliveryStatus = result.simulated ? "SIMULATED" : "SENT";
        providerMessageId = result.providerMessageId ?? null;
      } else {
        deliveryStatus = "FAILED";
      }
    }
  }

  await db.message.update({
    where: { id: message.id },
    data: { deliveryStatus, providerMessageId },
  });

  await notify({
    userId: recipientId,
    roundId: round.id,
    type: "MESSAGE_RECEIVED",
    title: "Nouveau message de ton lien secret 💌",
    body: "Un message t'attend dans ton espace WHITE LINKS.",
    dedupeKey: `msg-recv:${message.id}`,
  });

  return { ok: true, modStatus, deliveryStatus };
}

// ── WhatsApp inbound: command parsing & routing ──────────────────

export function parseWhatsAppCommand(text: string): { destination: Destination | null; body: string; needsMenu: boolean } {
  const trimmed = text.trim();
  if (/^1\s+/.test(trimmed)) {
    return { destination: "friend", body: trimmed.slice(2).trim(), needsMenu: false };
  }
  if (/^2\s+/.test(trimmed)) {
    return { destination: "admirer", body: trimmed.slice(2).trim(), needsMenu: false };
  }
  if (trimmed === CMD_TO_FRIEND || trimmed === "1") {
    return { destination: null, body: "", needsMenu: true };
  }
  if (trimmed === CMD_TO_ADMIRER || trimmed === "2") {
    return { destination: null, body: "", needsMenu: true };
  }
  return { destination: null, body: trimmed, needsMenu: true }; // ambiguous → ask
}

export const WA_INTRO = `💌 Bienvenue sur *WHITE LINKS*, le jeu secret du White Line Club ISSIG !

Pour envoyer un message anonyme :
*1* + ton message → à ton ami secret (celui que tu prends soin de)
*2* + ton message → à ton admirateur secret (celui qui t'écrit)

Ton identité reste toujours secrète ✨`;

export async function handleWhatsAppInbound(fromPhoneRaw: string, text: string, providerMessageId: string): Promise<{ handled: boolean; reply?: string }> {
  // Webhook dedupe (acceptance test #18)
  try {
    await db.inboundEvent.create({ data: { id: providerMessageId } });
  } catch {
    return { handled: true }; // duplicate webhook delivery
  }

  const { normalizePhone } = await import("@/lib/phone");
  const phone = normalizePhone(fromPhoneRaw);
  if (!phone) return { handled: false };

  const user = await db.user.findFirst({ where: { phone } });
  if (!user) return { handled: false };

  const membership = await currentActiveMembership(user.id);
  if (!membership) {
    return { handled: true, reply: "Aucune manche active pour ton compte. Rends-toi sur le site du club !" };
  }

  const parsed = parseWhatsAppCommand(text);
  if (parsed.needsMenu || (!parsed.destination && !parsed.body)) {
    return { handled: true, reply: WA_INTRO };
  }
  if (!parsed.body) {
    return { handled: true, reply: WA_INTRO };
  }

  const outcome = await sendMemberMessage({
    senderId: user.id,
    destination: parsed.destination!,
    body: parsed.body,
    source: "WHATSAPP",
  });

  if (!outcome.ok && outcome.error === "RATE_LIMITED") {
    return { handled: true, reply: "⏳ Trop de messages cette heure-ci. Réessaie un peu plus tard." };
  }
  if (!outcome.ok && outcome.error === "REJECTED_BY_MODERATION") {
    return {
      handled: true,
      reply: `🚫 Ton message n'a pas été transmis.\n${outcome.modExplanation ?? ""}\n\nTu peux le reformuler et le renvoyer.`,
    };
  }
  if (!outcome.ok) {
    return { handled: true, reply: `⚠️ ${outcome.message ?? "Envoi impossible pour le moment."}` };
  }
  const wa = whatsappStatus((await getSettings()).whatsappTestMode);
  if (outcome.deliveryStatus === "NOT_CONFIGURED") {
    return {
      handled: true,
      reply: "✅ Message transmis dans l'espace web de ton ami. (Envoi WhatsApp non configuré sur le serveur.)",
    };
  }
  return {
    handled: true,
    reply: wa.testMode
      ? "✅ Message transmis (mode test : aucun SMS réel envoyé)."
      : "✅ Message transmis anonymement. Merci de faire sourire !",
  };
}
