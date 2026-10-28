// ── WHITE LINKS core constants & domain rules ──

export const ROUND_STATUSES = [
  "draft",
  "registration_open",
  "registration_closed",
  "matching_pending",
  "active",
  "guessing_open",
  "revealed",
  "archived",
] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

// Server-enforced state machine transitions
export const VALID_TRANSITIONS: Record<RoundStatus, RoundStatus[]> = {
  draft: ["registration_open"],
  registration_open: ["registration_closed"],
  registration_closed: ["matching_pending"],
  matching_pending: ["active", "registration_closed"],
  active: ["guessing_open"],
  guessing_open: ["revealed"],
  revealed: ["archived"],
  archived: [],
};

export const MATCHING_MODES = ["OPEN", "CROSS_CATEGORY"] as const;
export type MatchingMode = (typeof MATCHING_MODES)[number];

export const CATEGORIES = ["A", "B"] as const;
export type MatchCategory = (typeof CATEGORIES)[number];

export const TIMEZONE = "Africa/Tunis";

export const MOD_STATUSES = ["PENDING", "ALLOWED", "REJECTED", "REVIEW"] as const;
export const DELIVERY_STATUSES = [
  "QUEUED",
  "SENT",
  "FAILED",
  "SIMULATED",
  "NOT_CONFIGURED",
] as const;

export const REASON_CODES = [
  "OK",
  "CONTACT_EXCHANGE",
  "IDENTITY_HINT",
  "HARASSMENT",
  "SEXUAL_HARASSMENT",
  "THREAT",
  "DISCRIMINATION",
  "RULE_BYPASS",
  "SPAM",
  "PROVIDER_ERROR",
] as const;
export type ReasonCode = (typeof REASON_CODES)[number];

export const NOTIF_TYPES = [
  "REGISTRATION_CONFIRMED",
  "REGISTRATION_CLOSING",
  "GAME_LAUNCH",
  "ASSIGNMENT",
  "DAILY_MISSION",
  "GUESSING_OPEN",
  "GUESSING_DEADLINE",
  "REVEAL",
  "NEXT_ROUND",
  "MESSAGE_RECEIVED",
  "MODERATION_REJECTED",
  "SYSTEM",
] as const;

// Command prefixes for WhatsApp routing (configurable via settings)
export const CMD_TO_FRIEND = "1"; // message the person I take care of
export const CMD_TO_ADMIRER = "2"; // reply to my secret admirer

export const SESSION_COOKIE = "wl_session";
export const SESSION_DAYS = 30;

export function isRoundStatus(v: string): v is RoundStatus {
  return (ROUND_STATUSES as readonly string[]).includes(v);
}
