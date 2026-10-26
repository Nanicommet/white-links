import type { ReasonCode } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// WHITE LINKS message moderation
// Layer 1: deterministic filters (contact details, obvious abuse)
// Layer 2: AI classification via z-ai-web-dev-sdk (server only)
// Failure policy: never silently bypass → "review" (human queue).
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
const HANDLE_RE = /(?:insta(?:gram)?|ig|snap(?:chat)?|sc|tiktok|tt|fb|facebook|messenger|telegram|tg|discord|x|twitter)\s*[:=@]?\s*[\w.]{3,}/i;
const AT_HANDLE_RE = /@[a-z0-9_.]{4,}/i;

const ABUSE_WORDS = [
  "idiot", "imbécile", "stupide", "bâtard", "batard", "connard", "salope",
  "putain de toi", "fdhina", "نكل", "خرا", "زبل", "قحبة", "شرموط",
  "kill you", "je vais te tuer", "نقتلك", "نضربك", "te casse la figure",
];

const SEXUAL_WORDS = ["sexe", "sex", "nud", "nue", "sexy photo", "photo chaude", "jadbit", "جذبت"];

function normalizeForScan(body: string): string {
  // Collapse common obfuscations used to slip contact details through.
  return body
    .toLowerCase()
    .replace(/[\u200b-\u200f\u2060]/g, "")
    .replace(/\s+/g, " ");
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
  if (URL_RE.test(rawBody) || HANDLE_RE.test(body)) {
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
  void AT_HANDLE_RE; // reserved: @handles are handled by AI layer to reduce false positives
  void PHONE_RE;
  void digitsOnly;

  for (const w of ABUSE_WORDS) {
    if (body.includes(w)) {
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
    if (body.includes(w)) {
      return {
        decision: "review",
        reasonCode: "SEXUAL_HARASSMENT",
        safeExplanation: "Message en attente de vérification par un modérateur.",
        confidence: 0.7,
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

export async function moderateMessage(
  body: string,
  opts: { aiEnabled: boolean }
): Promise<ModerationVerdict> {
  const filtered = deterministicFilter(body);
  if (filtered) return filtered;

  if (!opts.aiEnabled) {
    return {
      decision: "allow",
      reasonCode: "OK",
      safeExplanation: "Message accepté (modération automatique de base).",
      confidence: 0.6,
      source: "FILTER",
    };
  }

  try {
    const ZAI = (await import("z-ai-web-dev-sdk")).default;
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Message à classifier:\n"""\n${body.slice(0, 1500)}\n"""`,
        },
      ],
      temperature: 0.1,
      max_tokens: 300,
    });
    const text = completion.choices?.[0]?.message?.content?.trim() ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        decision: "review",
        reasonCode: "OK",
        safeExplanation: "Message placé en file de modération humaine.",
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
    const decision =
      parsed.decision === "allow" || parsed.decision === "reject" ? parsed.decision : "review";
    return {
      decision,
      reasonCode: (parsed.reason_code as ReasonCode) ?? "OK",
      safeExplanation:
        parsed.safe_explanation?.slice(0, 300) ??
        "Message vérifié par la modération automatique.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      source: "AI",
    };
  } catch {
    // Provider missing or failed → safe pending state, never silent bypass
    return {
      decision: "review",
      reasonCode: "PROVIDER_ERROR",
      safeExplanation:
        "Le service de modération est momentanément indisponible. Ton message sera vérifié par un modérateur humain.",
      confidence: 0,
      source: "AI",
    };
  }
}
