import type { ReasonCode } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// WHITE LINKS message moderation
// Layer 1: deterministic filters (contact details, obvious abuse)
// Layer 2: AI classification (OpenAI-compatible endpoint via AI_API_KEY)
// POLICY (club decision 2026-10): NO human approval step. Messages are
// delivered automatically unless the deterministic filter or a confident
// AI verdict rejects them. When the AI provider is missing, uncertain,
// or failing, messages are DELIVERED (fail-open) instead of parking in a
// human review queue. Deterministic filters still hard-block contact
// exchange and obvious abuse instantly, with no human in the loop.
// Never sends assignment mappings or phone numbers to the provider.
// ─────────────────────────────────────────────────────────────────

export interface ModerationVerdict {
  decision: "allow" | "reject" | "review";
  reasonCode: ReasonCode;
  safeExplanation: string; // participant-safe, no internal reasoning
  confidence: number; // 0..1
  source: "FILTER" | "AI";
}

const PHONE_RE =
  /(\+?\d[\s\-.]?)?(?:\(?\d{1,4}\)?[\s\-.]?){2,}\d{2,4}/g;
const EMAIL_RE = /[a-z0-9._%+-]+\s?(?:@|\(at\)|\[at\]|\[arobase\])\s?[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_RE = /((?:https?:\/\/|www\.)[^\s]+)|([a-z0-9-]+\.(com|tn|fr|net|org|io|me|link|snap|tk|ml)(\/[^\s]*)?)/gi;
const HANDLE_RE = /(?:insta(?:gram)?|ig|snap(?:chat)?|sc|tiktok|tt|fb|facebook|messenger|telegram|tg|discord|x|twitter)\s*[:=]\s*[\w.]{3,}/i;
// Platform keyword NEAR an @handle — filler words like "c'est" may sit
// between the keyword and the handle ("mon insta c'est @membre_officiel").
// This closed the gap previously covered by the AI layer, which is skipped
// when no AI_API_KEY is configured (messages must never depend on it).
const HANDLE_NEAR_RE = /(?:insta(?:gram)?|ig|snap(?:chat)?|sc|tiktok|tt|fb|facebook|messenger|telegram|tg|discord|x|twitter)\b[^.!?\n]{0,30}?@[a-z0-9_.]{3,}/i;
const AT_HANDLE_RE = /@[a-z0-9_.]{4,}/i;

const ABUSE_WORDS = [
  "idiot", "imbécile", "stupide", "bâtard", "batard", "connard", "salope",
  "putain de toi", "fdhina", "نكل", "خرا", "زبل", "قحبة", "شرموط",
  "kill you", "je vais te tuer", "نقتلك", "نضربك", "te casse la figure",
];

const SEXUAL_WORDS = ["sexe", "sex", "nue", "nues", "nude", "nudes", "sexy photo", "photo chaude", "jadbit", "جذبت"];

function normalizeForScan(body: string): string {
  // Collapse common obfuscations used to slip contact details through.
  return body
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2060]/g, "")
    .replace(/\s+/g, " ");
}

// Whole-word keyword matching with Unicode-aware boundaries.
// A naive substring match produced false positives on common French words:
// "bienvenue" and "avenue" both contain "nue" — legitimate welcome messages
// were being flagged as sexual content and stuck in the review queue.
// Lookarounds require a non-letter/non-digit on each side of the keyword,
// which works correctly for Latin scripts AND for Arabic keywords.
function keywordRegex(word: string): RegExp {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, "u");
}

export function deterministicFilter(rawBody: string): ModerationVerdict | null {
  const body = normalizeForScan(rawBody);

  // Obvious contact exchange → hard reject (protects anonymity)
  if (EMAIL_RE.test(rawBody)) {
    return {
      decision: "reject",
      reasonCode: "CONTACT_EXCHANGE",
      safeExplanation:
        "Ce message semble contenir une adresse e-mail. L'échange de coordonnées casse l'anonymat du jeu et n'est pas autorisé.",
      confidence: 0.95,
      source: "FILTER",
    };
  }
  if (URL_RE.test(rawBody) || HANDLE_RE.test(body) || HANDLE_NEAR_RE.test(body) || AT_HANDLE_RE.test(body)) {
    return {
      decision: "reject",
      reasonCode: "CONTACT_EXCHANGE",
      safeExplanation:
        "Ce message semble contenir un lien ou un réseau social. Les liens et identifiants de réseaux sociaux ne sont pas autorisés pendant la manche.",
      confidence: 0.9,
      source: "FILTER",
    };
  }
  // Digits-only sequences that look like phone numbers (6+ digits grouped)
  const digitsOnly = rawBody.replace(/[^\d]/g, "");
  const digitGroups = body.match(/(?:\d[\s\-.]?){6,}/g);
  if (digitGroups && digitGroups.some((g) => g.replace(/\D/g, "").length >= 6)) {
    return {
      decision: "reject",
      reasonCode: "CONTACT_EXCHANGE",
      safeExplanation:
        "Ce message semble contenir un numéro de téléphone. L'échange de numéros casse l'anonymat du jeu.",
      confidence: 0.9,
      source: "FILTER",
    };
  }
  void PHONE_RE;
  void digitsOnly;

  for (const w of ABUSE_WORDS) {
    if (keywordRegex(w).test(body)) {
      return {
        decision: "reject",
        reasonCode: "HARASSMENT",
        safeExplanation:
          "Ce message contient des propos blessants. Reformule ton message avec bienveillance ✨",
        confidence: 0.9,
        source: "FILTER",
      };
    }
  }
  for (const w of SEXUAL_WORDS) {
    if (keywordRegex(w).test(body)) {
      // No human queue (club policy): auto-reject with a kind explanation.
      return {
        decision: "reject",
        reasonCode: "SEXUAL_HARASSMENT",
        safeExplanation:
          "Ce message ne respecte pas l'esprit bienveillant du jeu. Reformule-le avec douceur ✨",
        confidence: 0.8,
        source: "FILTER",
      };
    }
  }
  return null;
}

const SYSTEM_PROMPT = `Tu es le modérateur du jeu "White Links", un jeu d'ami secret bienveillant du club étudiant White Line Club ISSIG (Gabès, Tunisie).
Les participants s'envoient des messages ANONYMES bienveillants. Ta mission: classifier le message ci-dessous.

Signaux de rejet:
- Tentative de révéler sa propre identité ou de deviner/deviner l'identité de l'autre (nom, classe, groupe, indice direct)
- Échange de contacts: téléphone, e-mail, réseaux sociaux, liens
- Harcèlement, insultes, menaces, chantage, propos sexuels, discrimination (sexe, religion, origine…)
- Contournement des règles du jeu

Important:
- Les compliments, blagues, encouragements, expressions tunisiennes naturelles (arabe tunisien, français) sont AUTORISÉS.
- Un simple "je pense te connaître" est autorisé; révéler un NOM ne l'est pas.

Réponds UNIQUEMENT avec ce JSON exact, sans texte autour:
{"decision":"allow"|"reject"|"review","reason_code":"OK|IDENTITY_HINT|CONTACT_EXCHANGE|HARASSMENT|SEXUAL_HARASSMENT|THREAT|DISCRIMINATION|RULE_BYPASS|SPAM","safe_explanation":"phrase courte et bienveillante en français pour le participant","confidence":0.0-1.0}`;

interface ChatChoiceMessage {
  choices?: { message?: { content?: string } }[];
}

// Calls an OpenAI-compatible /chat/completions endpoint.
// Configure with AI_API_KEY (+ optional AI_BASE_URL, AI_MODEL).
async function aiChat(messages: { role: string; content: string }[]): Promise<string> {
  const apiKey = process.env.AI_API_KEY?.trim();
  if (!apiKey) throw new Error("AI_NOT_CONFIGURED");
  const baseUrl = (process.env.AI_BASE_URL?.trim() || "https://api.z.ai/api/paas/v4").replace(/\/+$/, "");
  const model = process.env.AI_MODEL?.trim() || "glm-4.5-flash";
  // Short timeout: message sending must stay snappy. On timeout/absence the
  // caller fails open (delivers the message) per club policy — no human queue.
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 300 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`AI_HTTP_${res.status}`);
  const data = (await res.json()) as ChatChoiceMessage;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function moderateMessage(
  body: string,
  opts: { aiEnabled: boolean }
): Promise<ModerationVerdict> {
  const filtered = deterministicFilter(body);
  if (filtered) return filtered;

  // Fast path: AI not enabled or no API key configured → deliver instantly
  // on the strength of the deterministic filters alone. This is the normal
  // configuration on Vercel (no AI_API_KEY) and keeps sending latency at zero.
  if (!opts.aiEnabled || !process.env.AI_API_KEY?.trim()) {
    return {
      decision: "allow",
      reasonCode: "OK",
      safeExplanation: "Message accepté (modération automatique de base).",
      confidence: 0.6,
      source: "FILTER",
    };
  }

  try {
    const text = await aiChat([
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Message à classifier:\n"""\n${body.slice(0, 1500)}\n"""`,
      },
    ]);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // Unclear AI output → deliver (no human queue, club policy)
      return {
        decision: "allow",
        reasonCode: "OK",
        safeExplanation: "Message accepté (modération automatique de base).",
        confidence: 0.5,
        source: "AI",
      };
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      decision?: string;
      reason_code?: string;
      safe_explanation?: string;
      confidence?: number;
    };
    // Only a confident AI "reject" blocks a message. "review" delivers too —
    // there is no human approval step anymore.
    const decision = parsed.decision === "reject" ? "reject" : "allow";
    return {
      decision,
      reasonCode: (parsed.reason_code as ReasonCode) ?? "OK",
      safeExplanation:
        parsed.safe_explanation?.slice(0, 300) ??
        "Message vérifié par la modération automatique.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      source: "AI",
    };
  } catch (err) {
    // Provider missing or failed → fail open: deliver the message rather
    // than parking it in a human queue (club policy: no human approval).
    // OPS: always log the failure so outages are visible in Vercel logs —
    // the admin console also shows "FILTERS_ONLY" mode for moderation.
    console.warn("[moderation] AI layer unavailable — delivering on filters only:", err instanceof Error ? err.message : err);
    return {
      decision: "allow",
      reasonCode: "OK",
      safeExplanation: "Message accepté (modération automatique de base).",
      confidence: 0,
      source: "FILTER",
    };
  }
}
