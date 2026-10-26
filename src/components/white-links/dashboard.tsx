"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  ArrowRight, Clock, EyeOff, Gift, Lock, Mail, MessageCircleHeart, Sparkles, Trophy, UserRound, Users, CheckCircle2, Hourglass, ScrollText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { api, type DashboardData, type GuessData, type Me, type RevealData } from "./api";
import { useI18n } from "./i18n-context";
import { Countdown, EnvelopeArt, Confetti, Spinner, StatusPill, formatDate } from "./shared";

export function Dashboard({ me }: { me: Me }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [rewardOpen, setRewardOpen] = useState(false);

  const dashQuery = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<DashboardData>("/api/me/dashboard"),
    refetchInterval: 15000,
  });

  if (dashQuery.isLoading) return <Spinner />;
  const d = dashQuery.data;

  if (!d) return <Spinner />;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        {/* Greeting */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("dash.title")}</p>
            <h1 className="mt-1 font-display text-5xl leading-none">
              {t("dash.welcome")}, <span className="underline decoration-2 underline-offset-4">{me.displayName}</span>
            </h1>
          </div>
          {d.round && <StatusPill status={d.round.status} demo={d.round.isDemo} />}
        </div>

        {d.phase === "NO_ROUND" && (
          <div className="wl-card mt-8 p-10 text-center">
            <Hourglass className="mx-auto h-10 w-10 text-black/30" />
            <h2 className="mt-4 font-display text-3xl">{t("dash.noRound")}</h2>
            <p className="mt-2 text-sm text-black/60">{t("status.setupDesc")}</p>
          </div>
        )}

        {d.phase === "NOT_REGISTERED" && (
          <div className="wl-card mt-8 p-10 text-center">
            <UserRound className="mx-auto h-10 w-10 text-black/30" />
            <h2 className="mt-4 font-display text-3xl">{t("dash.notRegistered")}</h2>
            {d.round?.status === "registration_open" && (
              <Button onClick={() => (window.location.hash = "/white-links/register")} className="mt-5 rounded-full bg-black hover:bg-black/85">
                {t("dash.registerCta")} <ArrowRight className="ms-1 h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {d.phase === "WAITING" && <WaitingState d={d} />}

        {d.phase === "PLAYING" && <PlayingState d={d} me={me} onReward={() => setRewardOpen(true)} />}

        {d.phase === "REVEALED" && <RevealedState d={d} />}

        <RewardDialog open={rewardOpen} onOpenChange={setRewardOpen} />
      </div>
    </main>
  );
}

// ── WAITING (registered, round not started) ──

function WaitingState({ d }: { d: DashboardData }) {
  const { t, lang } = useI18n();
  return (
    <div className="mt-8 grid gap-5 lg:grid-cols-3">
      <div className="wl-card p-6 lg:col-span-2">
        <div className="flex items-center gap-3">
          <ScrollText className="h-5 w-5 text-black/60" />
          <h2 className="font-display text-2xl">{d.round?.name}</h2>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-black/65">
          {d.round?.status === "registration_open" && t("status.registration_open")}
          {d.round?.status === "registration_closed" && t("status.registration_closed")}
          {d.round?.status === "matching_pending" && t("status.matching_pending")}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-black/60">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 font-medium">
            <Users className="h-3.5 w-3.5" /> {t("register.category")}: {d.registration?.category === "A" ? t("register.categoryA") : t("register.categoryB")}
          </span>
          {d.registration?.verificationStatus === "PENDING" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-black/40 px-3 py-1 text-xs font-semibold">
              <Hourglass className="h-3.5 w-3.5" /> {t("dash.pendingValidation")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" /> {t("dash.verified")}
            </span>
          )}
        </div>
        {d.round?.registrationEnd && d.round.status === "registration_open" && (
          <div className="mt-6">
            <Countdown targetIso={d.round.registrationEnd} prefix={t("status.countdown.close")} />
          </div>
        )}
      </div>
      <div className="wl-card relative flex flex-col items-center justify-center overflow-hidden p-6 text-center">
        <EnvelopeArt className="w-36 opacity-90 wl-float" />
        <p className="mt-4 max-w-[200px] text-xs leading-relaxed text-black/50">{t("status.setupDesc")}</p>
      </div>
    </div>
  );
}

// ── PLAYING (active round) ──

function PlayingState({ d, me, onReward }: { d: DashboardData; me: Me; onReward: () => void }) {
  const { t, lang } = useI18n();
  const [missionDone, setMissionDone] = useState(false);
  const dayIndex = d.dayIndex ?? 0;
  const totalDays = d.totalDays ?? 14;
  const progress = Math.min(100, Math.round(((dayIndex + 1) / totalDays) * 100));

  return (
    <div className="mt-8 space-y-5">
      {/* Secret friend + mission + progress */}
      <div className="grid gap-5 lg:grid-cols-3">
        {/* My friend */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="wl-card p-6 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("dash.friend")}</p>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-3 py-1 text-[11px] font-semibold">
              <EyeOff className="h-3 w-3" /> Secret
            </span>
          </div>
          {d.friend ? (
            <>
              <h2 className="mt-3 font-display text-4xl leading-none">{d.friend.displayName}</h2>
              <div className="mt-4 space-y-2.5 text-sm">
                <p className="flex items-start gap-2 text-black/70">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                  <span><strong className="font-semibold text-black">{t("dash.interests")} :</strong> {d.friend.interests || t("dash.interestsEmpty")}</span>
                </p>
                {d.friend.giftPrefs && (
                  <p className="flex items-start gap-2 text-black/70">
                    <Gift className="mt-0.5 h-4 w-4 shrink-0" />
                    <span><strong className="font-semibold text-black">{t("register.gifts")} :</strong> {d.friend.giftPrefs}</span>
                  </p>
                )}
              </div>
              <Button onClick={() => (window.location.hash = "/white-links/messages")} className="mt-5 rounded-full bg-black px-6 hover:bg-black/85">
                <MessageCircleHeart className="h-4 w-4" /> {t("dash.friendCta")}
                {(d.admirerUnread ?? 0) > 0 && (
                  <span className="ms-2 rounded-full bg-white px-2 py-0.5 text-[10px] font-bold text-black">{d.admirerUnread}</span>
                )}
              </Button>
            </>
          ) : (
            <p className="mt-3 text-sm text-black/60">{t("common.error")}</p>
          )}
        </motion.div>

        {/* Daily mission */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="wl-card flex flex-col p-6">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("dash.mission")}</p>
          {d.mission ? (
            <>
              <div className="mt-3 rounded-2xl bg-black p-4 text-white">
                <p className="text-sm font-medium leading-relaxed">{lang === "ar" ? d.mission.ar : d.mission.fr}</p>
              </div>
              <button
                onClick={() => setMissionDone(true)}
                disabled={missionDone}
                className={`mt-3 inline-flex items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-semibold transition-colors ${missionDone ? "border-black bg-black text-white" : "border-black/20 hover:bg-black hover:text-white"}`}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {missionDone ? t("dash.missionDone") : t("common.confirm")}
              </button>
            </>
          ) : (
            <p className="mt-3 text-sm text-black/50">{t("missions.desc")}</p>
          )}
        </motion.div>
      </div>

      {/* Progress + countdown */}
      <div className="wl-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-56 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("dash.progress")}</p>
            <div className="mt-3 flex items-center gap-3">
              <Progress value={progress} className="h-2.5 flex-1" />
              <span className="font-display text-xl">{progress}%</span>
            </div>
            <p className="mt-2 text-xs text-black/50">
              {t("day")} {dayIndex + 1} / {totalDays} — {t("status.countdown.reveal")}
            </p>
          </div>
          <Countdown targetIso={d.round?.revealAt ?? d.round?.gameEnd} prefix={t("status.countdown.reveal")} compact />
        </div>
      </div>

      {/* Inbox preview */}
      <InboxPreview d={d} />

      {/* Guessing phase CTA */}
      {d.round?.status === "guessing_open" && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="wl-card border-2 border-black p-6 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("guess.title")}</p>
          <h3 className="mt-2 font-display text-4xl">{t("dash.guessCta")}</h3>
          <p className="mt-2 text-xs text-black/50">
            {t("dash.guessDeadline")} {d.round?.guessingDeadline && formatDate(d.round.guessingDeadline, lang)}
          </p>
          <Countdown targetIso={d.round?.guessingDeadline} compact />
          <Button onClick={() => (window.location.hash = "/white-links/guess")} className="mt-4 rounded-full bg-black px-8 hover:bg-black/85">
            {t("guess.title")} <ArrowRight className="ms-1 h-4 w-4" />
          </Button>
        </motion.div>
      )}
    </div>
  );
}

function InboxPreview({ d }: { d: DashboardData }) {
  const { t } = useI18n();
  return (
    <div className="wl-card p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.25em] text-black/50">
          <Mail className="h-4 w-4" /> {t("dash.inbox")}
        </p>
        <Button variant="outline" size="sm" onClick={() => (window.location.hash = "/white-links/messages")} className="rounded-full">
          {t("msg.title")} <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <p className="mt-3 text-sm text-black/60">{t("dash.inboxEmpty")}</p>
      {(d.admirerUnread ?? 0) > 0 && (
        <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-black px-3 py-1 text-xs font-semibold text-white">
          {d.admirerUnread} nouveau{(d.admirerUnread ?? 0) > 1 ? "x" : ""} message{((d.admirerUnread ?? 0) > 1) ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ── REVEALED ──

function RevealedState({ d }: { d: DashboardData }) {
  const { t } = useI18n();
  return (
    <div className="wl-card mt-8 p-8 text-center">
      <Trophy className="mx-auto h-10 w-10" />
      <h2 className="mt-4 font-display text-4xl">{t("status.revealed")}</h2>
      {d.round && <StatusPill status={d.round.status} demo={d.round.isDemo} />}
      <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-black/60">{t("reveal.celebrate")}</p>
      <Button onClick={() => (window.location.hash = "/white-links/reveal")} className="mt-6 rounded-full bg-black px-8 hover:bg-black/85">
        {t("dash.revealCta")} <ArrowRight className="ms-1 h-4 w-4" />
      </Button>
      {d.nextRound && d.nextRound.status === "registration_open" && (
        <p className="mt-5 text-sm text-black/60">
          {t("dash.nextRound")}: <strong>{d.nextRound.name}</strong> — {t("dash.registerCta")}
        </p>
      )}
    </div>
  );
}

// ── Reward preferences dialog ──

function RewardDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [ranked, setRanked] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  const rpQuery = useQuery({
    queryKey: ["reward-prefs"],
    queryFn: () =>
      api<{
        eligible: boolean;
        nextRound?: { id: string; name: string };
        existing?: { targetId: string; rank: number }[];
        participants?: { id: string; displayName: string }[];
      }>("/api/me/reward-preferences"),
    enabled: open,
  });

  const saveMutation = useMutation({
    mutationFn: (ranked: string[]) =>
      api("/api/me/reward-preferences", { method: "POST", body: { roundId: rpQuery.data?.nextRound?.id, ranked } }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["reward-prefs"] });
    },
  });

  const participants = rpQuery.data?.participants ?? [];
  const toggle = (id: string) => {
    setRanked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id]));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-3xl">{t("dash.rewardTitle")}</DialogTitle>
        </DialogHeader>
        {!rpQuery.data?.eligible ? (
          <p className="text-sm text-black/60">{t("dash.rewardDesc")}</p>
        ) : saved ? (
          <p className="rounded-xl bg-black px-4 py-3 text-sm font-medium text-white">{t("dash.rewardSubmitted")}</p>
        ) : (
          <>
            <p className="text-sm text-black/60">{t("dash.rewardDesc")}</p>
            <p className="text-xs text-black/50">
              {t("dash.rewardRank")} 1 → 3. {t("guess.desc")}
            </p>
            <div className="max-h-64 space-y-2 overflow-y-auto wl-scroll pe-1">
              {participants.map((p) => {
                const idx = ranked.indexOf(p.id);
                return (
                  <button
                    key={p.id}
                    onClick={() => toggle(p.id)}
                    className={`flex w-full items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${idx >= 0 ? "border-black bg-black text-white" : "hover:border-black/40"}`}
                  >
                    {p.displayName}
                    {idx >= 0 && <span className="font-display text-lg">#{idx + 1}</span>}
                  </button>
                );
              })}
            </div>
            <DialogFooter>
              <Button
                onClick={() => saveMutation.mutate(ranked)}
                disabled={ranked.length === 0 || saveMutation.isPending}
                className="w-full rounded-full bg-black hover:bg-black/85"
              >
                {saveMutation.isPending ? t("common.loading") : t("dash.rewardSave")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function GuessPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [choice, setChoice] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const guessQuery = useQuery({
    queryKey: ["guess"],
    queryFn: () => api<GuessData>("/api/me/guess"),
    refetchInterval: 20000,
  });

  const submitMutation = useMutation({
    mutationFn: (guessedId: string) => api("/api/me/guess", { method: "POST", body: { guessedId } }),
    onSuccess: () => {
      setConfirming(false);
      qc.invalidateQueries({ queryKey: ["guess"] });
    },
  });

  if (guessQuery.isLoading) return <Spinner />;
  const g = guessQuery.data;
  if (!g) return <Spinner />;

  const current = g.myGuess?.guessedId ?? null;
  const selected = choice ?? current;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="font-display text-5xl leading-[0.95]">{t("guess.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-black/60">{t("guess.desc")}</p>

        {!g.open ? (
          <div className="wl-card mt-8 p-10 text-center">
            <Lock className="mx-auto h-9 w-9 text-black/30" />
            <p className="mt-4 font-display text-2xl">
              {g.reason === "REVEALED"
                ? t("status.revealed")
                : g.reason === "NOT_REGISTERED"
                  ? t("dash.notRegistered")
                  : g.reason === "NO_ROUND"
                    ? t("dash.noRound")
                    : g.deadline
                      ? t("guess.deadlineClosed")
                      : "Les devinettes s'ouvriront en fin de manche 🔮"}
            </p>
            {g.deadline && g.reason !== "REVEALED" && (
              <p className="mt-2 text-xs text-black/50">{formatDate(g.deadline, lang)}</p>
            )}
          </div>
        ) : (
          <>
            <div className="wl-card mt-8 p-6">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("guess.participants")}</p>
              <div className="mt-4 grid max-h-96 gap-2 overflow-y-auto wl-scroll pe-1 sm:grid-cols-2">
                {(g.participants ?? [])
                  .filter((p) => !p.isMe)
                  .map((p) => (
                    <button
                      key={p.id}
                      onClick={() => { setChoice(p.id); setConfirming(true); }}
                      className={`rounded-xl border px-4 py-3 text-start text-sm font-medium transition-colors ${selected === p.id ? "border-black bg-black text-white" : "hover:border-black/40"}`}
                    >
                      {p.displayName}
                      {current === p.id && selected === p.id && (
                        <span className="ms-2 inline-flex items-center rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                          {t("guess.locked")}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            </div>

            {current && !confirming && (
              <p className="mt-5 flex items-center justify-center gap-2 rounded-full bg-neutral-100 px-4 py-2.5 text-center text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {t("guess.locked")} <strong>{g.participants?.find((p) => p.id === current)?.displayName}</strong>
                <span className="text-xs text-black/50">· {t("guess.lockedNote")}</span>
              </p>
            )}

            {confirming && selected && (
              <div className="wl-card mt-5 border-2 border-black p-5">
                <p className="text-sm font-semibold">{t("guess.confirm")} <span className="font-display text-xl">{g.participants?.find((p) => p.id === selected)?.displayName}</span> ?</p>
                <div className="mt-4 flex gap-2">
                  <Button onClick={() => submitMutation.mutate(selected)} disabled={submitMutation.isPending} className="rounded-full bg-black hover:bg-black/85">
                    {submitMutation.isPending ? t("common.loading") : t("guess.submit")}
                  </Button>
                  <Button variant="outline" onClick={() => { setConfirming(false); setChoice(current); }} className="rounded-full">
                    {t("common.cancel")}
                  </Button>
                </div>
              </div>
            )}

            <p className="mt-6 text-center text-xs text-black/45">
              <Clock className="me-1 inline h-3.5 w-3.5" />
              {t("dash.guessDeadline")} {g.deadline && formatDate(g.deadline, lang)}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export function RevealPage() {
  const { t, lang } = useI18n();
  const revealQuery = useQuery({
    queryKey: ["reveal"],
    queryFn: () => api<RevealData>("/api/me/reveal"),
    refetchInterval: 15000,
  });

  if (revealQuery.isLoading) return <Spinner />;
  const r = revealQuery.data;
  if (!r) return <Spinner />;

  if (!r.revealed) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <div className="wl-card relative overflow-hidden p-12">
            <EnvelopeArt className="mx-auto w-48 wl-float" />
            <h1 className="mt-6 font-display text-5xl">{t("reveal.locked")}</h1>
            <p className="mt-3 text-sm text-black/60">{t("reveal.lockedDesc")}</p>
            {r.round?.revealAt && (
              <div className="mt-6 flex justify-center">
                <Countdown targetIso={r.round.revealAt} prefix={t("status.countdown.reveal")} />
              </div>
            )}
            <div className="mx-auto mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-black">
              <Lock className="h-6 w-6 text-white" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  return <RevealedContent r={r} lang={lang} />;
}

function RevealedContent({ r, lang }: { r: RevealData; lang: string }) {
  const { t } = useI18n();
  void lang;
  return (
    <main className="flex-1">
      <Confetti active />
      <div className="mx-auto max-w-2xl px-4 py-14">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.5 }}>
          <div className="relative overflow-hidden rounded-[2rem] bg-black p-10 text-center text-white">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/50">{t("reveal.title")}</p>
            <h1 className="mt-3 font-display text-5xl leading-[0.95]">{t("reveal.admirer")}</h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6, duration: 0.6 }}
              className="mt-4 font-display text-6xl sm:text-7xl leading-none underline decoration-white/30 decoration-4 underline-offset-8"
            >
              {r.admirer?.displayName ?? "—"}
            </motion.p>

            {r.friend?.displayName && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.1 }} className="mt-8 rounded-2xl bg-white/10 px-6 py-4">
                <p className="text-xs uppercase tracking-[0.25em] text-white/50">{t("reveal.yourAssignment")}</p>
                <p className="mt-1.5 font-display text-3xl">{r.friend.displayName}</p>
              </motion.div>
            )}
          </div>

          {/* Guess result */}
          <div className="wl-card mt-6 p-6 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("reveal.guessTitle")}</p>
            {r.guess ? (
              <>
                <p className="mt-3 text-sm text-black/60">
                  {t("reveal.guessYouChose")} <strong>{r.guess.guessedName ?? "—"}</strong>
                </p>
                <p className={`mt-2 font-display text-3xl ${r.guess.correct ? "text-black" : "text-black/50"}`}>
                  {r.guess.correct ? t("reveal.guessCorrect") : t("reveal.guessWrong")}
                </p>
              </>
            ) : (
              <p className="mt-3 text-sm text-black/60">{t("reveal.guessNone")}</p>
            )}
            {r.isWinner && (
              <p className="mx-auto mt-4 inline-flex items-center gap-2 rounded-full bg-black px-4 py-2 text-xs font-bold uppercase tracking-wider text-white">
                <Trophy className="h-3.5 w-3.5" /> {t("reveal.rewardEligible")}
              </p>
            )}
          </div>

          {/* Next round */}
          {r.nextRound && (
            <div className="wl-card mt-6 p-6 text-center">
              <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("reveal.nextRound")}</p>
              <p className="mt-2 font-display text-3xl">{r.nextRound.name}</p>
              {r.nextRound.registrationStart && (
                <p className="mt-1 text-sm text-black/60">
                  {t("admin.regStart")}: {formatDate(r.nextRound.registrationStart)}
                </p>
              )}
              {r.nextRound.status === "registration_open" && (
                <Button onClick={() => (window.location.hash = "/white-links/register")} className="mt-4 rounded-full bg-black hover:bg-black/85">
                  {t("dash.registerCta")}
                </Button>
              )}
            </div>
          )}

          <p className="mt-8 text-center font-display text-2xl text-black/70">{t("reveal.celebrate")}</p>
          <div className="mt-4 text-center">
            <Button variant="outline" onClick={() => (window.location.hash = "/")} className="rounded-full">
              {t("reveal.backHome")}
            </Button>
          </div>
        </motion.div>
      </div>
    </main>
  );
}
