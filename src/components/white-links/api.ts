"use client";

// ── Typed API client + shared query hooks ──

export class ApiError extends Error {
  status: number;
  code: string;
  payload: Record<string, unknown>;
  constructor(status: number, code: string, payload: Record<string, unknown>) {
    super(code);
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export async function api<T>(
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: options?.method ?? "GET",
    headers: options?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
    cache: "no-store",
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? "ERROR"), data);
  }
  return data as T;
}

// ── Shared types (API payloads) ──

export interface PublicRound {
  id: string;
  name: string;
  status: string;
  registrationStart: string;
  registrationEnd: string;
  gameStart: string | null;
  gameEnd: string | null;
  guessingStart: string | null;
  guessingDeadline: string | null;
  revealAt: string | null;
  matchingMode: string;
  participantCount?: number;
}

export interface CurrentStatus {
  round: PublicRound | null;
  nextRound: { id: string; name: string; registrationStart: string; registrationEnd: string } | null;
  lastRevealed: { name: string; updatedAt: string } | null;
  serverTime: string;
}

export interface Me {
  id: string;
  email: string;
  displayName: string;
  phone: string;
  role: string;
  phoneVerified: boolean;
  restrictedUntil: string | null;
}

export interface DashboardData {
  phase: "NO_ROUND" | "NOT_REGISTERED" | "WAITING" | "PLAYING" | "REVEALED";
  round?: {
    id: string;
    name: string;
    status: string;
    registrationEnd?: string;
    gameStart?: string | null;
    gameEnd?: string | null;
    guessingStart?: string | null;
    guessingDeadline?: string | null;
    revealAt?: string | null;
    matchingMode?: string;
    messageMaxLength?: number;
  };
  registration?: { category: string; verificationStatus: string };
  friend?: { displayName: string; interests: string | null; giftPrefs: string | null } | null;
  admirer?: { displayName: string } | null;
  guess?: { guessedId: string; guessedName?: string | null; correct?: boolean } | null;
  isWinner?: boolean;
  unread?: number;
  admirerUnread?: number;
  notificationsUnread?: number;
  mission?: { fr: string; ar: string; icon: string } | null;
  dayIndex?: number;
  totalDays?: number;
  verified?: boolean;
  nextRound?: { id: string; name: string; registrationStart: string; status: string } | null;
}

export interface InboxMessage {
  id: string;
  mine: boolean;
  body: string;
  createdAt: string;
  readAt: string | null;
  modStatus: string;
  modExplanation: string | null;
  deliveryStatus: string | null;
}

export interface InboxData {
  round: { id: string; name: string; status: string; messageMaxLength: number } | null;
  revealed: boolean;
  threads: {
    friend: { exists: boolean; messages: InboxMessage[] };
    admirer: { exists: boolean; messages: InboxMessage[] };
  } | null;
  canSend: boolean;
}

export interface GuessData {
  open: boolean;
  reason?: string;
  deadline?: string | null;
  round?: { id: string; name: string; status: string };
  participants?: { id: string; displayName: string; isMe: boolean }[];
  myGuess?: { guessedId: string } | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface RevealData {
  revealed: boolean;
  reason?: string;
  round?: { id: string; name: string; status: string; guessingDeadline?: string | null; revealAt?: string | null };
  admirer?: { displayName: string | null };
  friend?: { displayName: string | null };
  guess?: { guessedId: string; guessedName: string | null; correct: boolean } | null;
  isWinner?: boolean;
  nextRound?: { id: string; name: string; registrationStart: string; registrationEnd: string; status: string } | null;
}
