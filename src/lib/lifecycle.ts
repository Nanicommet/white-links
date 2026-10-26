import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { generateMatching, verifyMatching } from "@/lib/matching";
import type { MatchParticipant } from "@/lib/matching";
import { VALID_TRANSITIONS, type RoundStatus } from "@/lib/constants";

// ── Settings singleton ──────────────────────────────────────────

export async function getSettings() {
  let s = await db.settings.findUnique({ where: { id: "global" } });
  if (!s) {
    // Race-safe creation: another worker may have created it concurrently
    s = await db.settings.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
  }
  return s;
}

// ── Lifecycle tick: idempotent automatic transitions ─────────────

export async function tick(): Promise<{ transitions: string[]; reminders: number }> {
  const settings = await getSettings();
  const transitions: string[] = [];
  let reminders = 0;
  if (!settings.autoTransitions) return { transitions, reminders };
  const now = new Date();

  // 1. Auto-close registration at deadline (acceptance test #2)
  const openRounds = await db.round.findMany({ where: { status: "registration_open" } });
  for (const round of openRounds) {
    // Closing reminder (sent once — dedupeKey guarantees idempotency)
    const remindAt = new Date(round.registrationEnd.getTime() - settings.reminderCloseHours * 3600 * 1000);
    if (now >= remindAt && now < round.registrationEnd) {
      const regs = await db.registration.findMany({
        where: { roundId: round.id, status: "ACTIVE" },
        select: { userId: true },
      });
      for (const r of regs) {
        const created = await notify({
          userId: r.userId,
          roundId: round.id,
          type: "REGISTRATION_CLOSING",
          title: "Les inscriptions ferment bientôt ⏳",
          body: `La manche « ${round.name} » ferme ses inscriptions le ${round.registrationEnd.toLocaleString("fr-FR")}. Invite tes camarades !`,
          dedupeKey: `closing-reminder:${round.id}:${r.userId}`,
        });
        if (created) reminders++;
      }
    }
    if (now >= round.registrationEnd) {
      await db.round.update({ where: { id: round.id }, data: { status: "registration_closed" } });
      transitions.push(`round ${round.id}: registration_open → registration_closed`);
      await audit(null, "system", "ROUND_AUTO_CLOSE", round.id, { name: round.name });
    }
  }

  // 2. Closed rounds stay for admin validation → matching_pending is set by admin finalize

  // 3. Auto-open guessing window on the final day
  const activeRounds = await db.round.findMany({ where: { status: "active" } });
  for (const round of activeRounds) {
    if (round.guessingStart && now >= round.guessingStart && round.guessingStart < round.gameEnd!) {
      await db.round.update({ where: { id: round.id }, data: { status: "guessing_open" } });
      transitions.push(`round ${round.id}: active → guessing_open`);
      await audit(null, "system", "ROUND_AUTO_GUESSING", round.id, {});
      const regs = await db.registration.findMany({
        where: { roundId: round.id, status: "ACTIVE" },
        select: { userId: true },
      });
      for (const r of regs) {
        await notify({
          userId: r.userId,
          roundId: round.id,
          type: "GUESSING_OPEN",
          title: "Devinettes ouvertes 🔮",
          body: "Qui prenait soin de toi en secret ? Soumets ton choix avant la révélation !",
          dedupeKey: `guessing-open:${round.id}:${r.userId}`,
        });
      }
    }
  }

  return { transitions, reminders };
}

// ── Transition validation ────────────────────────────────────────

export function canTransition(from: RoundStatus, to: RoundStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export async function transitionRound(
  roundId: string,
  to: RoundStatus,
  actorId: string | null,
  actorName: string
): Promise<{ ok: boolean; error?: string }> {
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };
  if (!canTransition(round.status as RoundStatus, to)) {
    return { ok: false, error: `INVALID_TRANSITION:${round.status}→${to}` };
  }
  await db.round.update({ where: { id: roundId }, data: { status: to } });
  await audit(actorId, actorName, `ROUND_TRANSITION:${round.status}→${to}`, roundId, {
    name: round.name,
  });
  return { ok: true };
}

// ── Eligibility & matching finalization ──────────────────────────

export async function eligibleParticipants(roundId: string) {
  const regs = await db.registration.findMany({
    where: { roundId, status: "ACTIVE", verificationStatus: "APPROVED" },
    include: { user: { select: { id: true, displayName: true, restrictedUntil: true } } },
  });
  return regs.filter((r) => !r.user.restrictedUntil || r.user.restrictedUntil < new Date());
}

export async function matchingDiagnostics(roundId: string) {
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };
  const settings = await getSettings();
  const eligible = await eligibleParticipants(roundId);
  const pending = await db.registration.findMany({
    where: { roundId, status: "ACTIVE", verificationStatus: "PENDING" },
    select: { id: true, phone: true, category: true },
  });
  const aCount = eligible.filter((r) => r.category === "A").length;
  const bCount = eligible.filter((r) => r.category === "B").length;
  const prefs = await db.rewardPreference.findMany({
    where: { roundId, status: { in: ["PENDING", "CONFLICT"] } },
    include: { winner: { select: { displayName: true } } },
  });

  const errors: string[] = [];
  if (eligible.length < settings.minParticipants) {
    errors.push(
      `Pas assez de participants éligibles : ${eligible.length} (minimum ${settings.minParticipants}).`
    );
  }
  if (round.matchingMode === "CROSS_CATEGORY" && aCount !== bCount) {
    errors.push(
      `Groupes déséquilibrés en mode croisé : ${aCount} catégorie A vs ${bCount} catégorie B. Ajoute ou retire des participants pour équilibrer, ou passe en mode libre.`
    );
  }
  return {
    ok: true,
    round: { id: round.id, name: round.name, status: round.status, matchingMode: round.matchingMode },
    eligible: eligible.length,
    pendingCount: pending.length,
    byCategory: { A: aCount, B: bCount },
    preferenceConflicts: prefs.length,
    errors,
    canMatch: errors.length === 0,
  };
}

export async function previewMatching(roundId: string, actorId: string | null, actorName: string) {
  const diag = await matchingDiagnostics(roundId);
  if (!diag.ok || !diag.canMatch) {
    return { ok: false, errors: diag.errors ?? ["ROUND_NOT_FOUND"], pairs: [], stats: null };
  }
  const round = await db.round.findUnique({ where: { id: roundId } });
  const eligible = await eligibleParticipants(roundId);
  const participants: MatchParticipant[] = eligible.map((r) => ({
    id: r.userId,
    category: r.category === "B" ? "B" : "A",
  }));
  const prefs = await db.rewardPreference.findMany({ where: { roundId } });
  const prefMap = new Map<string, string[]>();
  for (const p of prefs.sort((x, y) => x.rank - y.rank)) {
    const list = prefMap.get(p.winnerId) ?? [];
    list.push(p.targetId);
    prefMap.set(p.winnerId, list);
  }
  const result = generateMatching(
    participants,
    {
      mode: round!.matchingMode === "CROSS_CATEGORY" ? "CROSS_CATEGORY" : "OPEN",
      preferences: [...prefMap.entries()].map(([winnerId, rankedTargets]) => ({
        winnerId,
        rankedTargets,
      })),
    },
    (await getSettings()).minParticipants
  );
  if (result.ok) {
    const names = new Map(eligible.map((r) => [r.userId, r.user.displayName]));
    await audit(actorId, actorName, "MATCHING_PREVIEW", roundId, {
      pairs: result.pairs.length,
      reciprocal: result.stats.reciprocalPairs,
    });
    return {
      ok: true,
      errors: [],
      stats: result.stats,
      pairs: result.pairs.map((p) => ({
        from: names.get(p.giverId) ?? p.giverId,
        to: names.get(p.recipientId) ?? p.recipientId,
        honored: p.honoredPreference,
      })),
    };
  }
  return { ok: false, errors: result.errors, pairs: [], stats: null };
}

export async function finalizeMatching(
  roundId: string,
  actorId: string | null,
  actorName: string
): Promise<{ ok: boolean; error?: string; assigned?: number }> {
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };
  if (round.status !== "registration_closed" && round.status !== "matching_pending") {
    return { ok: false, error: `INVALID_ROUND_STATUS:${round.status}` };
  }
  await db.round.update({ where: { id: roundId }, data: { status: "matching_pending" } });

  // Idempotency: if ACTIVE assignments already exist, do not recreate
  const existing = await db.assignment.findMany({
    where: { roundId, status: "ACTIVE" },
  });
  if (existing.length > 0) {
    const count = existing.length;
    await db.round.update({ where: { id: roundId }, data: { status: "active" } });
    return { ok: true, assigned: count };
  }

  const settings = await getSettings();
  const eligible = await eligibleParticipants(roundId);
  const participants: MatchParticipant[] = eligible.map((r) => ({
    id: r.userId,
    category: r.category === "B" ? "B" : "A",
  }));
  const prefs = await db.rewardPreference.findMany({ where: { roundId } });
  const prefMap = new Map<string, string[]>();
  for (const p of [...prefs].sort((x, y) => x.rank - y.rank)) {
    const list = prefMap.get(p.winnerId) ?? [];
    list.push(p.targetId);
    prefMap.set(p.winnerId, list);
  }
  const result = generateMatching(
    participants,
    {
      mode: round.matchingMode === "CROSS_CATEGORY" ? "CROSS_CATEGORY" : "OPEN",
      preferences: [...prefMap.entries()].map(([winnerId, rankedTargets]) => ({
        winnerId,
        rankedTargets,
      })),
    },
    settings.minParticipants
  );
  if (!result.ok) {
    await db.round.update({ where: { id: roundId }, data: { status: "registration_closed" } });
    await audit(actorId, actorName, "MATCHING_FAILED", roundId, { errors: result.errors });
    return { ok: false, error: result.errors.join(" | ") };
  }
  // Server-side revalidation before commit (defense in depth)
  const recheck = verifyMatching(participants, result.pairs, {
    mode: round.matchingMode === "CROSS_CATEGORY" ? "CROSS_CATEGORY" : "OPEN",
  });
  if (!recheck.valid) {
    await db.round.update({ where: { id: roundId }, data: { status: "registration_closed" } });
    return { ok: false, error: "INVARIANT_VIOLATION:" + recheck.errors.join(",") };
  }

  const now = new Date();
  const gameEnd = new Date(now.getTime() + settings.gameDays * 24 * 3600 * 1000);
  const guessingStart = new Date(gameEnd.getTime() - settings.guessingHours * 3600 * 1000);

  // Atomic commit: assignments + round update in one transaction
  const namesById = new Map(eligible.map((r) => [r.userId, r.user.displayName]));
  await db.$transaction(async (tx) => {
    await tx.assignment.deleteMany({ where: { roundId } });
    for (const pair of result.pairs) {
      await tx.assignment.create({
        data: {
          roundId,
          giverId: pair.giverId,
          recipientId: pair.recipientId,
          honoredPreference: pair.honoredPreference,
        },
      });
    }
    await tx.round.update({
      where: { id: roundId },
      data: {
        status: "active",
        gameStart: now,
        gameEnd,
        guessingStart,
        guessingDeadline: gameEnd,
        revealAt: round.revealAt ?? gameEnd,
      },
    });
    for (const p of prefs) {
      await tx.rewardPreference.update({
        where: { id: p.id },
        data: { status: result.pairs.some((q) => q.giverId === p.winnerId && q.recipientId === p.targetId && q.honoredPreference) ? "HONORED" : "NOT_HONORED" },
      });
    }
  });

  await audit(actorId, actorName, "MATCHING_FINALIZED", roundId, {
    assigned: result.pairs.length,
    reciprocal: result.stats.reciprocalPairs,
    honored: result.stats.honoredPreferences,
  });

  // Notify participants only after successful finalization (idempotent)
  for (const pair of result.pairs) {
    await notify({
      userId: pair.giverId,
      roundId,
      type: "ASSIGNMENT",
      title: "Ton ami secret t'attend 💌",
      body: `La manche « ${round.name} » démarre ! Tu prends soin de ${namesById.get(pair.recipientId)} en secret. Rendez-vous dans ton espace.`,
      dedupeKey: `assignment:${roundId}:${pair.giverId}`,
    });
    await notify({
      userId: pair.recipientId,
      roundId,
      type: "GAME_LAUNCH",
      title: "Le jeu commence ✨",
      body: `Quelqu'un prend soin de toi en secret pendant « ${round.name} ». Reponds-lui depuis ton espace !`,
      dedupeKey: `launch:${roundId}:${pair.recipientId}`,
    });
  }

  return { ok: true, assigned: result.pairs.length };
}

// ── Reveal ───────────────────────────────────────────────────────

export async function winnersOfRound(roundId: string) {
  const assignments = await db.assignment.findMany({
    where: { roundId, status: "ACTIVE" },
    select: { giverId: true, recipientId: true },
  });
  const admirerOf = new Map(assignments.map((a) => [a.recipientId, a.giverId]));
  const guesses = await db.guess.findMany({ where: { roundId } });
  const winners = guesses
    .filter((g) => admirerOf.get(g.guesserId) === g.guessedId)
    .map((g) => ({ winnerId: g.guesserId, guessedId: g.guessedId }));
  return { winners, guesses, admirerOf };
}

export async function revealRound(
  roundId: string,
  actorId: string | null,
  actorName: string
): Promise<{ ok: boolean; error?: string }> {
  const round = await db.round.findUnique({ where: { id: roundId } });
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };
  if (round.status !== "guessing_open" && round.status !== "active") {
    return { ok: false, error: `INVALID_ROUND_STATUS:${round.status}` };
  }
  const now = new Date();
  if (round.guessingDeadline && now < round.guessingDeadline) {
    return { ok: false, error: "GUESSING_STILL_OPEN" };
  }
  await db.round.update({ where: { id: roundId }, data: { status: "revealed" } });
  await audit(actorId, actorName, "REVEAL_TRIGGERED", roundId, { name: round.name });

  const regs = await db.registration.findMany({
    where: { roundId, status: "ACTIVE" },
    select: { userId: true },
  });
  const { winners } = await winnersOfRound(roundId);
  const winnerIds = new Set(winners.map((w) => w.winnerId));
  for (const r of regs) {
    await notify({
      userId: r.userId,
      roundId,
      type: "REVEAL",
      title: "La révélation est là 🎉",
      body: "Découvre qui prenait soin de toi en secret… et qui tu as fait sourire !",
      dedupeKey: `reveal:${roundId}:${r.userId}`,
    });
    if (winnerIds.has(r.userId)) {
      await notify({
        userId: r.userId,
        roundId,
        type: "NEXT_ROUND",
        title: "Récompense de devin 🏆",
        body: "Tu as deviné juste ! Exprime tes préférences pour la prochaine manche depuis ton espace.",
        dedupeKey: `reward:${roundId}:${r.userId}`,
      });
    }
  }
  return { ok: true };
}

// ── Advance registration for next round (final 48h overlap) ─────

export async function enableAdvanceRegistration(
  currentRoundId: string,
  actorId: string | null,
  actorName: string
): Promise<{ ok: boolean; error?: string; roundId?: string }> {
  const round = await db.round.findUnique({ where: { id: currentRoundId } });
  if (!round) return { ok: false, error: "ROUND_NOT_FOUND" };
  if (!round.gameEnd) return { ok: false, error: "ROUND_NOT_ACTIVE" };
  const settings = await getSettings();
  const existingNext = await db.round.findFirst({
    where: { name: { contains: `après ${round.name}` } },
  });
  if (existingNext) return { ok: true, roundId: existingNext.id };

  const regStart = new Date(
    Math.max(Date.now(), round.gameEnd.getTime() - 48 * 3600 * 1000)
  );
  const regEnd = new Date(regStart.getTime() + settings.registrationHours * 3600 * 1000);
  const next = await db.round.create({
    data: {
      name: `Manche après ${round.name}`,
      status: "draft",
      registrationStart: regStart,
      registrationEnd: regEnd,
      matchingMode: round.matchingMode,
    },
  });
  await db.round.update({
    where: { id: currentRoundId },
    data: { nextRoundRegistrationEnabled: true },
  });
  await audit(actorId, actorName, "ADVANCE_REGISTRATION_ENABLED", next.id, {
    from: currentRoundId,
    regStart: regStart.toISOString(),
    regEnd: regEnd.toISOString(),
  });
  // Notify participants of upcoming registration
  const regs = await db.registration.findMany({
    where: { roundId: currentRoundId, status: "ACTIVE" },
    select: { userId: true },
  });
  for (const r of regs) {
    await notify({
      userId: r.userId,
      roundId: next.id,
      type: "NEXT_ROUND",
      title: "La prochaine manche arrive 🔜",
      body: `Les inscriptions pour « ${next.name} » ouvrent bientôt. Prépare tes messages !`,
      dedupeKey: `next-round-announce:${next.id}:${r.userId}`,
    });
  }
  return { ok: true, roundId: next.id };
}
