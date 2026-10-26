import crypto from "crypto";
import type { MatchCategory, MatchingMode } from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────
// WHITE LINKS matching engine
// Invariants (server-enforced, verified post-generation):
//  1. Every participant gives to exactly one recipient.
//  2. Every participant receives from exactly one giver.
//  3. No self-assignment.
//  4. CROSS_CATEGORY: every assignment crosses groups A↔B.
//  5. Exclusions (if any) are respected.
//  6. Reward preferences guide (never override) the invariants.
//  7. Reciprocal pairs minimized when feasible (crypto randomness).
// ─────────────────────────────────────────────────────────────────

export interface MatchParticipant {
  id: string;
  category: MatchCategory;
}

export interface PreferenceInput {
  winnerId: string;
  rankedTargets: string[]; // up to 3, priority order
}

export interface MatchOptions {
  mode: MatchingMode;
  exclusions?: Record<string, string[]>; // giverId -> forbidden recipientIds
  preferences?: PreferenceInput[];
  attempts?: number;
}

export interface MatchPair {
  giverId: string;
  recipientId: string;
  honoredPreference: boolean;
}

export interface MatchResult {
  ok: boolean;
  errors: string[];
  pairs: MatchPair[];
  stats: {
    participants: number;
    reciprocalPairs: number;
    honoredPreferences: number;
  };
}

function secureShuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countReciprocal(pairs: MatchPair[]): number {
  const map = new Map<string, string>();
  for (const p of pairs) map.set(p.giverId, p.recipientId);
  let n = 0;
  for (const [giver, recipient] of map) {
    if (map.get(recipient) === giver) n++;
  }
  return n / 2; // each reciprocal pair counted twice
}

export function verifyMatching(
  participants: MatchParticipant[],
  pairs: MatchPair[],
  opts: MatchOptions
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const ids = new Set(participants.map((p) => p.id));
  const cat = new Map(participants.map((p) => [p.id, p.category]));

  const giverSeen = new Set<string>();
  const recipSeen = new Set<string>();
  for (const p of pairs) {
    if (!ids.has(p.giverId)) errors.push(`Unknown giver ${p.giverId}`);
    if (!ids.has(p.recipientId)) errors.push(`Unknown recipient ${p.recipientId}`);
    if (p.giverId === p.recipientId) errors.push(`Self-assignment ${p.giverId}`);
    if (giverSeen.has(p.giverId)) errors.push(`Duplicate giver ${p.giverId}`);
    if (recipSeen.has(p.recipientId)) errors.push(`Duplicate recipient ${p.recipientId}`);
    giverSeen.add(p.giverId);
    recipSeen.add(p.recipientId);
    if (opts.mode === "CROSS_CATEGORY" && cat.get(p.giverId) === cat.get(p.recipientId)) {
      errors.push(`Cross-category violation ${p.giverId}→${p.recipientId}`);
    }
    const excl = opts.exclusions?.[p.giverId];
    if (excl && excl.includes(p.recipientId)) {
      errors.push(`Exclusion violation ${p.giverId}→${p.recipientId}`);
    }
  }
  for (const id of ids) {
    if (!giverSeen.has(id)) errors.push(`Participant ${id} has no outgoing assignment`);
    if (!recipSeen.has(id)) errors.push(`Participant ${id} has no incoming assignment`);
  }
  return { valid: errors.length === 0, errors };
}

function isAllowed(
  giver: MatchParticipant,
  recipient: MatchParticipant,
  opts: MatchOptions
): boolean {
  if (giver.id === recipient.id) return false;
  if (opts.mode === "CROSS_CATEGORY" && giver.category === recipient.category) return false;
  const excl = opts.exclusions?.[giver.id];
  if (excl && excl.includes(recipient.id)) return false;
  return true;
}

// Randomized backtracking completion of a partial matching.
function completeMatching(
  participants: MatchParticipant[],
  pinned: Map<string, { recipient: string; honored: boolean }>,
  opts: MatchOptions
): MatchPair[] | null {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const usedRecipients = new Set<string>();
  const pairs: MatchPair[] = [];

  for (const [giverId, pin] of pinned) {
    usedRecipients.add(pin.recipient);
    pairs.push({ giverId, recipientId: pin.recipient, honoredPreference: pin.honored });
  }

  const openGivers = participants
    .map((p) => p.id)
    .filter((id) => !pinned.has(id));
  const openRecipients = participants
    .map((p) => p.id)
    .filter((id) => !usedRecipients.has(id));

  const assignment = new Map<string, string>(); // giverId -> recipientId (open part)
  const usedOpenRecipients = new Set<string>();

  const dfs = (idx: number, budget: { n: number }): boolean => {
    if (idx >= openGivers.length) return true;
    if (budget.n-- <= 0) return false;
    const giverId = openGivers[idx];
    const giver = byId.get(giverId)!;
    const candidates = secureShuffle(
      openRecipients.filter(
        (r) => !usedOpenRecipients.has(r) && isAllowed(giver, byId.get(r)!, opts)
      )
    );
    for (const r of candidates) {
      assignment.set(giverId, r);
      usedOpenRecipients.add(r);
      if (dfs(idx + 1, budget)) return true;
      assignment.delete(giverId);
      usedOpenRecipients.delete(r);
      if (budget.n <= 0) return false;
    }
    return false;
  };

  const budget = { n: 200000 };
  if (!dfs(0, budget)) return null;

  for (const [giverId, recipientId] of assignment) {
    pairs.push({ giverId, recipientId, honoredPreference: false });
  }
  return pairs;
}

export function generateMatching(
  participants: MatchParticipant[],
  opts: MatchOptions,
  minParticipants = 4
): MatchResult {
  const base: MatchResult = {
    ok: false,
    errors: [],
    pairs: [],
    stats: { participants: participants.length, reciprocalPairs: 0, honoredPreferences: 0 },
  };

  if (participants.length < minParticipants) {
    base.errors.push(
      `TOO_FEW_PARTICIPANTS:${participants.length}:${minParticipants}`
    );
    return base;
  }

  // Distinct ids required
  const idSet = new Set(participants.map((p) => p.id));
  if (idSet.size !== participants.length) {
    base.errors.push("DUPLICATE_PARTICIPANT_IDS");
    return base;
  }

  if (opts.mode === "CROSS_CATEGORY") {
    const a = participants.filter((p) => p.category === "A");
    const b = participants.filter((p) => p.category === "B");
    if (a.length !== b.length) {
      base.errors.push(`GROUP_IMBALANCE:A=${a.length}:B=${b.length}`);
      return base;
    }
    if (a.length < 2) {
      base.errors.push("GROUP_TOO_SMALL");
      return base;
    }
  }

  // ── Reward preferences: conflict-safe priority assignment ──
  const pinned = new Map<string, { recipient: string; honored: boolean }>();
  const takenTargets = new Set<string>();

  if (opts.preferences && opts.preferences.length > 0) {
    // Group winners by their rank-1 target to detect conflicts.
    const byTop = new Map<string, string[]>(); // targetId -> winnerIds
    for (const pref of opts.preferences) {
      if (!pref.rankedTargets?.length) continue;
      const top = pref.rankedTargets[0];
      if (!idSet.has(top) || top === pref.winnerId) continue;
      const list = byTop.get(top) ?? [];
      list.push(pref.winnerId);
      byTop.set(top, list);
    }
    // Priority order per conflicting target: secure random tie-break.
    const priority: { winnerId: string; targetId: string }[] = [];
    for (const [target, winners] of byTop) {
      for (const w of secureShuffle(winners)) priority.push({ winnerId: w, targetId: target });
    }
    // Single-requesters keep natural priority too.
    for (const pref of secureShuffle(opts.preferences)) {
      if (pref.rankedTargets?.length && !byTop.get(pref.rankedTargets[0])?.includes(pref.winnerId)) {
        if (idSet.has(pref.rankedTargets[0]) && pref.rankedTargets[0] !== pref.winnerId) {
          priority.push({ winnerId: pref.winnerId, targetId: pref.rankedTargets[0] });
        }
      }
    }

    const byId = new Map(participants.map((p) => [p.id, p]));
    for (const { winnerId } of priority) {
      if (pinned.has(winnerId)) continue;
      const winner = byId.get(winnerId);
      if (!winner) continue;
      const pref = opts.preferences.find((p) => p.winnerId === winnerId)!;
      for (const targetId of pref.rankedTargets.slice(0, 3)) {
        if (targetId === winnerId || !idSet.has(targetId)) continue;
        if (takenTargets.has(targetId) || pinned.has(targetId)) continue;
        const target = byId.get(targetId)!;
        if (!isAllowed(winner, target, opts)) continue;
        pinned.set(winnerId, { recipient: targetId, honored: true });
        takenTargets.add(targetId);
        break;
      }
    }
  }

  // ── Randomized completion, minimizing reciprocal pairs ──
  const attempts = Math.max(20, opts.attempts ?? 150);
  let best: MatchPair[] | null = null;
  let bestReciprocal = Number.POSITIVE_INFINITY;

  for (let i = 0; i < attempts; i++) {
    const candidate = completeMatching(participants, pinned, opts);
    if (!candidate) continue;
    const rec = countReciprocal(candidate);
    if (rec < bestReciprocal) {
      best = candidate;
      bestReciprocal = rec;
      if (rec === 0) break;
    }
  }

  if (!best) {
    base.errors.push("NO_VALID_ASSIGNMENT:constraints make a valid matching impossible");
    return base;
  }

  const check = verifyMatching(participants, best, opts);
  if (!check.valid) {
    base.errors.push(...check.errors);
    return base;
  }

  base.ok = true;
  base.pairs = best;
  base.stats.reciprocalPairs = bestReciprocal;
  base.stats.honoredPreferences = best.filter((p) => p.honoredPreference).length;
  return base;
}
