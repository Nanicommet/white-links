"use client";

import React, { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, Archive, BadgeCheck, Ban, CalendarPlus, CheckCircle2, ChevronRight, CircleAlert,
  ClipboardList, Cog, Database, Eye, EyeOff, Flag, Gift, Hourglass, KeyRound, Lock, MailX,
  Plus, RefreshCw, Rocket, ShieldCheck, Sparkles, Trash2, Unlock, UserCheck, Users, Wand2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "./api";
import { useI18n } from "./i18n-context";
import { Countdown, Spinner, StatusPill, formatDate } from "./shared";

// ── Types ──

interface Overview {
  round: {
    id: string; name: string; status: string; matchingMode: string; isDemo: boolean;
    registrationStart: string; registrationEnd: string;
    gameStart: string | null; gameEnd: string | null; guessingStart: string | null;
    guessingDeadline: string | null; revealAt: string | null;
    nextRoundRegistrationEnabled: boolean;
    counts: { registrations: number; assignments: number; messages: number; guesses: number };
  } | null;
  countsByCategory: { A: number; B: number };
  unverified: number;
  pendingModeration: number;
  openReports: number;
  failedDeliveries: number;
  openResetRequests: number;
  stats: { totalMembers: number; totalMessages: number; revealedRounds: number };
  integrations: Record<string, string>;
}

interface RoundRow {
  id: string; name: string; status: string; matchingMode: string; isDemo: boolean;
  registrationStart: string; registrationEnd: string;
  gameStart: string | null; gameEnd: string | null; guessingStart: string | null;
  guessingDeadline: string | null; revealAt: string | null;
  _count: { registrations: number; assignments: number; messages: number; guesses: number };
}

interface ParticipantRow {
  id: string; displayName: string; email: string; phone: string; phoneVerified: boolean;
  category: string; interests: string | null; giftPrefs: string | null; status: string;
  verificationStatus: string; isDemo: boolean; restrictedUntil: string | null; createdAt: string;
}

interface PreviewResult {
  ok: boolean; errors: string[];
  pairs?: { from: string; to: string; honored: boolean }[];
  stats?: { reciprocalPairs: number; honoredPreferences: number } | null;
}

function useAdminAction() {
  const qc = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method: method ?? "POST", body }),
    onSuccess: () => {
      setErr(null);
      qc.invalidateQueries();
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const map: Record<string, string> = {
          GROUP_IMBALANCE: "Groupes déséquilibrés — voir l'onglet Matching.",
          TOO_FEW_PARTICIPANTS: "Pas assez de participants éligibles.",
          GUESSING_STILL_OPEN: "La fenêtre de devinettes est encore ouverte.",
          CONFIRMATION_REQUIRED: "Confirmation requise.",
          INVALID_TRANSITION: "Transition non autorisée par le cycle de vie.",
          REGISTRATION_END_IN_PAST: "La date de fin d'inscription est déjà passée.",
        };
        setErr(map[e.code] ?? e.code);
      } else setErr("Erreur");
    },
  });
  return { mutation, err };
}

export function AdminPage() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState("overview");

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50">{t("admin.title")}</p>
            <h1 className="mt-1 font-display text-4xl leading-none">White Links · Console</h1>
          </div>
          <ShieldCheck className="h-8 w-8 text-black/20" />
        </div>

        <Tabs value={tab} onValueChange={setTab} className="mt-6">
          <TabsList className="h-auto flex-wrap justify-start gap-1 rounded-2xl bg-neutral-100 p-1">
            {[
              { v: "overview", icon: Activity, label: t("admin.overview") },
              { v: "rounds", icon: Rocket, label: t("admin.rounds") },
              { v: "participants", icon: Users, label: t("admin.participants") },
              { v: "matching", icon: Wand2, label: t("admin.matching") },
              { v: "moderation", icon: Flag, label: t("admin.moderation") },
              { v: "rewards", icon: Gift, label: t("admin.rewards") },
              { v: "settings", icon: Cog, label: t("admin.settings") },
              { v: "integrations", icon: Database, label: t("admin.integrations") },
              { v: "audit", icon: ClipboardList, label: t("admin.audit") },
            ].map((i) => (
              <TabsTrigger key={i.v} value={i.v} className="gap-1.5 rounded-xl px-3 py-2 text-xs data-[state=active]:bg-white">
                <i.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{i.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent value="overview"><OverviewTab /></TabsContent>
          <TabsContent value="rounds"><RoundsTab /></TabsContent>
          <TabsContent value="participants"><ParticipantsTab /></TabsContent>
          <TabsContent value="matching"><MatchingTab /></TabsContent>
          <TabsContent value="moderation"><ModerationTab /></TabsContent>
          <TabsContent value="rewards"><RewardsTab /></TabsContent>
          <TabsContent value="settings"><SettingsTab /></TabsContent>
          <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
          <TabsContent value="audit"><AuditTab /></TabsContent>
        </Tabs>
        <p className="mt-8 text-center text-[10px] text-black/30">{lang === "ar" ? "لوحة الإدارة" : "Administration WHITE LINKS"}</p>
      </div>
    </main>
  );
}

// ── Overview ──

function OverviewTab() {
  const { t, lang } = useI18n();
  const q = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => api<Overview>("/api/admin/overview"),
    refetchInterval: 15000,
  });
  const { mutation, err } = useAdminAction();
  const demoMutation = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>("/api/admin/demo", { method: "POST" }),
    onSuccess: () => window.location.reload(),
  });

  if (q.isLoading) return <Spinner />;
  const o = q.data!;

  const stat = (label: string, value: number | string, Icon: React.ElementType, warn = false) => (
    <div className={`wl-card p-4 ${warn ? "border-amber-300 bg-amber-50/50" : ""}`}>
      <Icon className="h-4 w-4 text-black/50" />
      <p className="mt-2 font-display text-3xl leading-none">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-black/50">{label}</p>
    </div>
  );

  return (
    <div className="mt-4 space-y-5">
      {err && <ErrorBar msg={err} />}
      {o.round ? (
        <div className="wl-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-3xl">{o.round.name}</h2>
              <StatusPill status={o.round.status} demo={o.round.isDemo} />
              <span className="rounded-full bg-neutral-100 px-3 py-1 text-xs font-semibold">
                {o.round.matchingMode === "CROSS_CATEGORY" ? t("admin.modeCross") : t("admin.modeOpen")}
              </span>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs">
            <div className="rounded-xl bg-neutral-50 p-3">
              <p className="font-bold uppercase tracking-wider text-black/40">{t("admin.regEnd")}</p>
              <p className="mt-1 font-medium">{formatDate(o.round.registrationEnd, lang)}</p>
              {(o.round.status === "registration_open") && <Countdown targetIso={o.round.registrationEnd} compact />}
            </div>
            {o.round.gameEnd && (
              <div className="rounded-xl bg-neutral-50 p-3">
                <p className="font-bold uppercase tracking-wider text-black/40">Fin du jeu</p>
                <p className="mt-1 font-medium">{formatDate(o.round.gameEnd, lang)}</p>
              </div>
            )}
            {o.round.guessingStart && (
              <div className="rounded-xl bg-neutral-50 p-3">
                <p className="font-bold uppercase tracking-wider text-black/40">Devinettes dès</p>
                <p className="mt-1 font-medium">{formatDate(o.round.guessingStart, lang)}</p>
              </div>
            )}
            {o.round.revealAt && (
              <div className="rounded-xl bg-neutral-50 p-3">
                <p className="font-bold uppercase tracking-wider text-black/40">{t("admin.reveal")}</p>
                <p className="mt-1 font-medium">{formatDate(o.round.revealAt, lang)}</p>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="wl-card p-8 text-center">
          <Hourglass className="mx-auto h-9 w-9 text-black/30" />
          <p className="mt-3 font-display text-2xl">{t("admin.noRound")}</p>
          <Button onClick={() => demoMutation.mutate()} disabled={demoMutation.isPending} variant="outline" className="mt-4 rounded-full">
            <Sparkles className="h-4 w-4" /> {t("admin.demoSeed")}
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {stat(t("admin.eligible"), o.round ? o.countsByCategory.A + o.countsByCategory.B : 0, Users)}
        {stat(`Cat. A / B`, `${o.countsByCategory.A} / ${o.countsByCategory.B}`, UserCheck)}
        {stat(t("admin.unverified"), o.unverified, KeyRound, o.unverified > 0)}
        {stat(t("admin.pendingModeration"), o.pendingModeration, Flag, o.pendingModeration > 0)}
        {stat(t("admin.openReports"), o.openReports, MailX, o.openReports > 0)}
        {stat(t("admin.failedDeliveries"), o.failedDeliveries, CircleAlert, o.failedDeliveries > 0)}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {stat("Membres", o.stats.totalMembers, Users)}
        {stat("Messages", o.stats.totalMessages, Activity)}
        {stat("Manches révélées", o.stats.revealedRounds, Archive)}
      </div>

      {o.openResetRequests > 0 && (
        <p className="flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
          <KeyRound className="h-4 w-4" /> {o.openResetRequests} demande(s) de réinitialisation de mot de passe en attente — onglet Participants.
        </p>
      )}
    </div>
  );
}

// ── Rounds ──

function RoundsTab() {
  const { t, lang } = useI18n();
  const q = useQuery({
    queryKey: ["admin-rounds"],
    queryFn: () => api<{ rounds: RoundRow[] }>("/api/admin/rounds"),
    refetchInterval: 15000,
  });
  const { mutation, err } = useAdminAction();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", registrationStart: "", registrationEnd: "", matchingMode: "OPEN" });

  const create = () => {
    mutation.mutate({
      path: "/api/admin/rounds",
      body: {
        name: form.name,
        registrationStart: form.registrationStart ? new Date(form.registrationStart).toISOString() : new Date().toISOString(),
        registrationEnd: form.registrationEnd ? new Date(form.registrationEnd).toISOString() : new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        matchingMode: form.matchingMode,
      },
    });
    setCreating(false);
  };

  if (q.isLoading) return <Spinner />;

  const roundAction = (id: string, action: string, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    mutation.mutate({ path: `/api/admin/rounds/${id}/action`, body: { action, confirm: !!confirmMsg } });
  };

  return (
    <div className="mt-4 space-y-4">
      {err && <ErrorBar msg={err} />}
      <div className="flex justify-end">
        <Button onClick={() => setCreating(true)} className="rounded-full bg-black hover:bg-black/85">
          <Plus className="h-4 w-4" /> {t("admin.createRound")}
        </Button>
      </div>

      {q.data?.rounds.map((r) => (
        <div key={r.id} className="wl-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="font-display text-2xl">{r.name}</h3>
              <StatusPill status={r.status} demo={r.isDemo} />
              <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-[11px] font-semibold">
                {r.matchingMode === "CROSS_CATEGORY" ? "Croisé" : "Libre"}
              </span>
            </div>
            <p className="text-xs text-black/50">
              {r._count.registrations} inscrits · {r._count.assignments} attributions · {r._count.messages} messages · {r._count.guesses} devinettes
            </p>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-black/50">
            <span className="rounded-full bg-neutral-50 px-2.5 py-1">Ouverture: {formatDate(r.registrationStart, lang)}</span>
            <span className="rounded-full bg-neutral-50 px-2.5 py-1">Fermeture: {formatDate(r.registrationEnd, lang)}</span>
            {r.gameEnd && <span className="rounded-full bg-neutral-50 px-2.5 py-1">Fin: {formatDate(r.gameEnd, lang)}</span>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {r.status === "draft" && (
              <Button size="sm" onClick={() => roundAction(r.id, "open_registration")} className="rounded-full bg-black hover:bg-black/85">
                <Unlock className="h-3.5 w-3.5" /> {t("admin.openReg")}
              </Button>
            )}
            {r.status === "registration_open" && (
              <>
                <Button size="sm" variant="outline" onClick={() => roundAction(r.id, "close_registration")} className="rounded-full">
                  <Lock className="h-3.5 w-3.5" /> {t("admin.closeReg")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => roundAction(r.id, "advance_registration")} className="rounded-full">
                  <CalendarPlus className="h-3.5 w-3.5" /> {t("admin.advanceReg")}
                </Button>
              </>
            )}
            {r.status === "registration_closed" && (
              <Button
                size="sm"
                onClick={() => roundAction(r.id, "finalize_matching", t("admin.finalizeConfirm"))}
                className="rounded-full bg-black hover:bg-black/85"
              >
                <Wand2 className="h-3.5 w-3.5" /> {t("admin.finalize")}
              </Button>
            )}
            {r.status === "active" && (
              <>
                <Button size="sm" variant="outline" onClick={() => roundAction(r.id, "open_guessing")} className="rounded-full">
                  <Eye className="h-3.5 w-3.5" /> {t("admin.openGuessing")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => roundAction(r.id, "advance_registration")} className="rounded-full">
                  <CalendarPlus className="h-3.5 w-3.5" /> {t("admin.advanceReg")}
                </Button>
              </>
            )}
            {(r.status === "guessing_open" || r.status === "active") && (
              <Button size="sm" onClick={() => roundAction(r.id, "reveal", t("admin.revealConfirm"))} className="rounded-full bg-black hover:bg-black/85">
                <Sparkles className="h-3.5 w-3.5" /> {t("admin.reveal")}
              </Button>
            )}
            {r.status === "revealed" && (
              <Button size="sm" variant="outline" onClick={() => roundAction(r.id, "archive")} className="rounded-full">
                <Archive className="h-3.5 w-3.5" /> {t("admin.archive")}
              </Button>
            )}
            {r.status === "draft" && (
              <Button size="sm" variant="ghost" onClick={() => mutation.mutate({ path: `/api/admin/rounds/${r.id}`, method: "DELETE" })} className="rounded-full text-red-600 hover:bg-red-50">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      ))}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display text-3xl">{t("admin.createRound")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="round-name">{t("admin.roundName")}</Label>
              <Input id="round-name" className="mt-1.5" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Manche Novembre 2026" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="round-start">{t("admin.regStart")}</Label>
                <Input id="round-start" type="datetime-local" className="mt-1.5" value={form.registrationStart} onChange={(e) => setForm({ ...form, registrationStart: e.target.value })} />
              </div>
              <div>
                <Label htmlFor="round-end">{t("admin.regEnd")}</Label>
                <Input id="round-end" type="datetime-local" className="mt-1.5" value={form.registrationEnd} onChange={(e) => setForm({ ...form, registrationEnd: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>{t("admin.mode")}</Label>
              <Select value={form.matchingMode} onValueChange={(v) => setForm({ ...form, matchingMode: v })}>
                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">{t("admin.modeOpen")}</SelectItem>
                  <SelectItem value="CROSS_CATEGORY">{t("admin.modeCross")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} disabled={form.name.trim().length < 3 || mutation.isPending} className="w-full rounded-full bg-black hover:bg-black/85">
              {t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Participants ──

function ParticipantsTab() {
  const { t, lang } = useI18n();
  const q = useQuery({
    queryKey: ["admin-participants"],
    queryFn: () =>
      api<{ round: { id: string; name: string } | null; registrations: ParticipantRow[]; resetRequests: { id: string; user: { displayName: string; email: string }; createdAt: string }[] }>(
        "/api/admin/participants"
      ),
    refetchInterval: 15000,
  });
  const { mutation, err } = useAdminAction();
  const [tempPwd, setTempPwd] = useState<{ name: string; pwd: string } | null>(null);

  const act = (id: string, action: string) => {
    mutation.mutate(
      { path: `/api/admin/participants/${id}/action`, body: { action } },
      {
        onSuccess: (data) => {
          const d = data as { tempPassword?: string };
          if (d.tempPassword) setTempPwd({ name: "", pwd: d.tempPassword });
        },
      }
    );
  };

  if (q.isLoading) return <Spinner />;
  const regs = q.data?.registrations ?? [];

  const badge = (r: ParticipantRow) => {
    if (r.status === "WITHDRAWN") return <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-black/50">{t("admin.withdrawn")}</span>;
    if (r.status === "REMOVED") return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">Retiré</span>;
    if (r.verificationStatus === "PENDING") return <span className="rounded-full border border-dashed border-amber-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600">À valider</span>;
    if (r.verificationStatus === "REJECTED") return <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">Rejeté</span>;
    return <span className="rounded-full bg-black px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">OK</span>;
  };

  return (
    <div className="mt-4 space-y-4">
      {err && <ErrorBar msg={err} />}
      {(q.data?.resetRequests ?? []).length > 0 && (
        <div className="wl-card border-amber-300 bg-amber-50/50 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <KeyRound className="h-4 w-4" /> Demandes de réinitialisation
          </p>
          <div className="mt-3 space-y-2">
            {q.data!.resetRequests.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-sm">
                <span>{r.user.displayName} <span className="text-black/40">({r.user.email})</span></span>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-full"
                  onClick={() => {
                    const reg = regs.find((x) => x.email === r.user.email);
                    if (reg) act(reg.id, "reset_password");
                    else setTempPwd({ name: r.user.displayName, pwd: "Aucune inscription trouvée" });
                  }}
                >
                  {t("admin.resetPassword")}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="wl-card overflow-hidden">
        <div className="max-h-[70vh] overflow-auto wl-scroll">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-neutral-50 text-[11px] uppercase tracking-wider text-black/50">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">Membre</th>
                <th className="px-3 py-3 text-start font-semibold">Téléphone</th>
                <th className="px-3 py-3 text-start font-semibold">Cat.</th>
                <th className="px-3 py-3 text-start font-semibold">{t("admin.status")}</th>
                <th className="px-3 py-3 text-start font-semibold">{t("admin.actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {regs.map((r) => (
                <tr key={r.id} className="hover:bg-neutral-50/60">
                  <td className="px-4 py-3">
                    <p className="font-semibold">{r.displayName} {r.isDemo && <span className="ms-1 rounded bg-neutral-100 px-1.5 text-[9px] font-bold uppercase text-black/40">démo</span>}</p>
                    <p className="text-xs text-black/45">{r.email}</p>
                    {r.interests && <p className="mt-0.5 max-w-64 truncate text-[11px] text-black/40">{r.interests}</p>}
                  </td>
                  <td className="px-3 py-3 font-mono text-xs" dir="ltr">{r.phone}</td>
                  <td className="px-3 py-3">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-bold">{r.category === "A" ? "A" : "B"}</span>
                  </td>
                  <td className="px-3 py-3">{badge(r)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {r.verificationStatus === "PENDING" && r.status === "ACTIVE" && (
                        <>
                          <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs" onClick={() => act(r.id, "approve")}>
                            <BadgeCheck className="h-3 w-3" /> {t("admin.approve")}
                          </Button>
                          <Button size="sm" variant="outline" className="h-7 rounded-full px-2.5 text-xs text-red-600" onClick={() => act(r.id, "reject")}>
                            <XCircle className="h-3 w-3" /> {t("admin.reject")}
                          </Button>
                        </>
                      )}
                      {r.status === "ACTIVE" && r.restrictedUntil === null && (
                        <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-xs text-red-600" onClick={() => act(r.id, "restrict")}>
                          <Ban className="h-3 w-3" /> {t("admin.restrict")}
                        </Button>
                      )}
                      {r.restrictedUntil && (
                        <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-xs" onClick={() => act(r.id, "unrestrict")}>
                          <CheckCircle2 className="h-3 w-3" /> Débloquer
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" className="h-7 rounded-full px-2.5 text-xs" onClick={() => act(r.id, "reset_password")}>
                        <KeyRound className="h-3 w-3" /> {t("admin.resetPassword")}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
              {regs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-black/40">{t("admin.noRound")}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={!!tempPwd} onOpenChange={(v) => !v && setTempPwd(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl"><KeyRound className="h-5 w-5" /> {t("admin.tempPassword")}</DialogTitle>
          </DialogHeader>
          <p className="rounded-xl bg-neutral-100 px-4 py-3 text-center font-mono text-lg font-bold tracking-wider">{tempPwd?.pwd}</p>
          <p className="text-center text-xs text-black/50">Communique ce mot de passe au membre {tempPwd?.name || "concerné"} — il devra le changer après connexion.</p>
        </DialogContent>
      </Dialog>
      <p className="text-center text-[10px] text-black/30">{lang === "ar" ? "" : "Chaque action sensible est enregistrée dans le journal d'audit."}</p>
    </div>
  );
}

// ── Matching ──

function MatchingTab() {
  const { t } = useI18n();
  const roundsQ = useQuery({
    queryKey: ["admin-rounds"],
    queryFn: () => api<{ rounds: RoundRow[] }>("/api/admin/rounds"),
    refetchInterval: 15000,
  });
  const [selected, setSelected] = useState<string>("");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [diag, setDiag] = useState<{ eligible: number; pendingCount: number; byCategory: { A: number; B: number }; errors: string[]; canMatch: boolean; preferenceConflicts: number } | null>(null);
  const { mutation, err } = useAdminAction();

  const rounds = roundsQ.data?.rounds ?? [];
  const currentId = selected || rounds.find((r) => !["archived"].includes(r.status))?.id || "";

  const runDiagnostics = async () => {
    const res = await api<typeof diag>(`/api/admin/rounds/${currentId}/action`, { method: "POST", body: { action: "diagnostics" } });
    setDiag(res as never);
  };
  const runPreview = async () => {
    const res = await api<PreviewResult>(`/api/admin/rounds/${currentId}/action`, { method: "POST", body: { action: "preview_matching" } });
    setPreview(res);
    await runDiagnostics();
  };

  return (
    <div className="mt-4 space-y-4">
      {err && <ErrorBar msg={err} />}
      <div className="wl-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label>{t("admin.rounds")}</Label>
            <Select value={currentId} onValueChange={(v) => { setSelected(v); setPreview(null); setDiag(null); }}>
              <SelectTrigger className="mt-1.5"><SelectValue placeholder={t("admin.noRound")} /></SelectTrigger>
              <SelectContent>
                {rounds.map((r) => (
                  <SelectItem key={r.id} value={r.id}>{r.name} — {r.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={runDiagnostics} disabled={!currentId} className="rounded-full">
            <Activity className="h-4 w-4" /> Diagnostics
          </Button>
          <Button variant="outline" onClick={runPreview} disabled={!currentId} className="rounded-full">
            <Eye className="h-4 w-4" /> {t("admin.previewMatching")}
          </Button>
        </div>

        {diag && (
          <div className="mt-4 space-y-2 rounded-2xl bg-neutral-50 p-4 text-sm">
            <p className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <span><strong>{diag.eligible}</strong> {t("admin.eligible")}</span>
              <span><strong>{diag.pendingCount}</strong> {t("admin.unverified")}</span>
              <span>A: <strong>{diag.byCategory.A}</strong></span>
              <span>B: <strong>{diag.byCategory.B}</strong></span>
            </p>
            {diag.errors.length > 0 ? (
              <div className="mt-2 space-y-1">
                {diag.errors.map((e, i) => (
                  <p key={i} className="flex items-start gap-2 text-red-600"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {e}</p>
                ))}
              </div>
            ) : (
              <p className="flex items-center gap-2 font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" /> {t("admin.matchingOk")}</p>
            )}
          </div>
        )}

        {preview && (
          <div className="mt-4">
            {preview.ok ? (
              <div className="rounded-2xl border border-black/10 p-4">
                <p className="flex flex-wrap items-center gap-3 text-sm font-semibold">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {t("admin.matchingOk")}
                  <span className="text-xs font-normal text-black/50">
                    {t("admin.matchingReciprocal")}: {preview.stats?.reciprocalPairs} · {t("admin.matchingHonored")}: {preview.stats?.honoredPreferences}
                  </span>
                </p>
                <div className="mt-3 max-h-64 space-y-1.5 overflow-y-auto wl-scroll text-sm">
                  {preview.pairs?.map((p, i) => (
                    <div key={i} className="flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2">
                      <span className="font-medium">{p.from}</span>
                      <ChevronRight className="h-4 w-4 text-black/30 rtl:rotate-180" />
                      <span className="font-medium">{p.to}</span>
                      {p.honored && <span className="rounded-full bg-black px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">préférence</span>}
                    </div>
                  ))}
                </div>
                <p className="mt-2 flex items-center gap-1.5 text-xs text-black/40"><EyeOff className="h-3 w-3" /> Aperçu administrateur — jamais exposé aux participants.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
                {preview.errors.map((e, i) => (
                  <p key={i} className="flex items-start gap-2 text-sm text-red-700"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {e}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Moderation ──

function ModerationTab() {
  const { t, lang } = useI18n();
  const q = useQuery({
    queryKey: ["admin-moderation"],
    queryFn: () =>
      api<{
        reviewMessages: { id: string; body: string; senderName: string; roundName: string; modStatus: string; modReason: string | null; modExplanation: string | null; createdAt: string }[];
        reports: { id: string; reason: string; reporterName: string; roundName: string; message: { id: string; body: string } | null; createdAt: string }[];
      }>("/api/admin/moderation"),
    refetchInterval: 15000,
  });
  const { mutation, err } = useAdminAction();

  if (q.isLoading) return <Spinner />;
  const d = q.data!;

  const decide = (type: string, id: string, decision: string) =>
    mutation.mutate({ path: "/api/admin/moderation", body: { type, id, decision } });

  return (
    <div className="mt-4 space-y-5">
      {err && <ErrorBar msg={err} />}
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-display text-2xl"><Hourglass className="h-5 w-5" /> {t("admin.pendingModeration")} ({d.reviewMessages.length})</h3>
        {d.reviewMessages.length === 0 ? (
          <p className="wl-card p-6 text-center text-sm text-black/40">File vide ✨</p>
        ) : (
          d.reviewMessages.map((m) => (
            <div key={m.id} className="wl-card mb-3 p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-black/50">
                <span className="font-semibold text-black">{m.senderName}</span>
                <span>· {m.roundName} · {formatDate(m.createdAt, lang)}</span>
                {m.modReason && <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[10px]">{m.modReason}</span>}
              </div>
              <p className="mt-2 rounded-xl bg-neutral-50 px-4 py-3 text-sm leading-relaxed">{m.body}</p>
              {m.modExplanation && <p className="mt-1.5 text-xs italic text-black/50">IA : {m.modExplanation}</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => decide("message", m.id, "allow")} className="rounded-full bg-black hover:bg-black/85">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {t("admin.allow")}
                </Button>
                <Button size="sm" variant="outline" onClick={() => decide("message", m.id, "reject")} className="rounded-full text-red-600">
                  <XCircle className="h-3.5 w-3.5" /> {t("admin.reject")}
                </Button>
              </div>
            </div>
          ))
        )}
      </section>
      <section>
        <h3 className="mb-3 flex items-center gap-2 font-display text-2xl"><Flag className="h-5 w-5" /> {t("admin.openReports")} ({d.reports.length})</h3>
        {d.reports.length === 0 ? (
          <p className="wl-card p-6 text-center text-sm text-black/40">Aucun signalement ✨</p>
        ) : (
          d.reports.map((r) => (
            <div key={r.id} className="wl-card mb-3 p-4">
              <p className="text-xs text-black/50">
                <span className="font-semibold text-black">{r.reporterName}</span> · {r.roundName} · {formatDate(r.createdAt, lang)}
              </p>
              <p className="mt-1.5 text-sm font-medium">{r.reason}</p>
              {r.message && <p className="mt-2 rounded-xl bg-neutral-50 px-4 py-3 text-sm leading-relaxed">« {r.message.body} »</p>}
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => decide("report", r.id, "remove_message")} className="rounded-full text-red-600">
                  <Ban className="h-3.5 w-3.5" /> Retirer le message
                </Button>
                <Button size="sm" variant="ghost" onClick={() => decide("report", r.id, "dismiss")} className="rounded-full">
                  Rejeter le signalement
                </Button>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

// ── Rewards ──

function RewardsTab() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["admin-rewards"],
    queryFn: () =>
      api<{
        round: { id: string; name: string } | null;
        winners: { winnerId: string; winnerName: string; admirerName: string }[];
        upcomingRound: { id: string; name: string } | null;
        conflicts: { targetId: string; targetName: string; claimants: { winnerId: string; winnerName: string; rank: number }[] }[];
      }>("/api/admin/rewards"),
    refetchInterval: 15000,
  });
  const { mutation, err } = useAdminAction();

  if (q.isLoading) return <Spinner />;
  const d = q.data!;

  return (
    <div className="mt-4 space-y-4">
      {err && <ErrorBar msg={err} />}
      <div className="wl-card p-5">
        <h3 className="flex items-center gap-2 font-display text-2xl"><Gift className="h-5 w-5" /> {t("admin.winners")} — {d.round?.name ?? "—"}</h3>
        {d.winners.length === 0 ? (
          <p className="mt-3 text-sm text-black/40">{t("admin.noWinners")}</p>
        ) : (
          <div className="mt-3 space-y-2">
            {d.winners.map((w) => (
              <div key={w.winnerId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 px-4 py-2.5 text-sm">
                <span className="font-semibold">{w.winnerName}</span>
                <span className="text-xs text-black/50">deviné : <strong>{w.admirerName}</strong></span>
              </div>
            ))}
          </div>
        )}
      </div>
      {d.conflicts.length > 0 && (
        <div className="wl-card border-amber-300 bg-amber-50/40 p-5">
          <h3 className="flex items-center gap-2 font-display text-2xl text-amber-800"><CircleAlert className="h-5 w-5" /> {t("admin.conflicts")}</h3>
          {d.conflicts.map((c) => (
            <div key={c.targetId} className="mt-3 rounded-xl bg-white p-3 text-sm">
              <p className="font-semibold">« {c.targetName} » réclamé par :</p>
              <ul className="mt-1.5 space-y-0.5 text-xs text-black/60">
                {c.claimants.map((cl) => (
                  <li key={cl.winnerId}>{cl.winnerName} — rang #{cl.rank}</li>
                ))}
              </ul>
            </div>
          ))}
          {d.upcomingRound && (
            <Button
              onClick={() => mutation.mutate({ path: "/api/admin/rewards", body: { roundId: d.upcomingRound!.id } })}
              className="mt-4 rounded-full bg-black hover:bg-black/85"
            >
              <RefreshCw className="h-4 w-4" /> {t("admin.resolveAuto")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Settings ──

function SettingsTab() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["admin-settings"],
    queryFn: () =>
      api<{
        settings: {
          registrationHours: number; gameDays: number; guessingHours: number; messageMaxLength: number;
          messageRatePerHour: number; minParticipants: number; missionsEnabled: boolean; autoTransitions: boolean;
          aiModerationEnabled: boolean; whatsappTestMode: boolean; retentionDays: number;
          categoryALabel: string; categoryBLabel: string; reminderCloseHours: number;
        };
      }>("/api/admin/settings"),
  });
  const { mutation, err } = useAdminAction();
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState<Record<string, number | boolean | string> | null>(null);

  if (q.isLoading) return <Spinner />;
  const s = form ?? (q.data!.settings as unknown as Record<string, number | boolean | string>);

  const num = (key: string, label: string) => (
    <div>
      <Label htmlFor={`set-${key}`}>{label}</Label>
      <Input
        id={`set-${key}`}
        type="number"
        className="mt-1.5"
        value={String(s[key] ?? "")}
        onChange={(e) => setForm({ ...s, [key]: parseInt(e.target.value, 10) || 0 })}
      />
    </div>
  );
  const bool = (key: string, label: string) => (
    <div className="flex items-center justify-between rounded-xl border border-black/10 px-4 py-3">
      <Label htmlFor={`set-${key}`} className="text-sm font-medium">{label}</Label>
      <Switch id={`set-${key}`} checked={Boolean(s[key])} onCheckedChange={(v) => setForm({ ...s, [key]: v })} />
    </div>
  );

  const save = () => {
    mutation.mutate(
      { path: "/api/admin/settings", method: "PUT", body: form ?? q.data!.settings },
      { onSuccess: () => setSaved(true) }
    );
  };

  return (
    <div className="mt-4 space-y-4">
      {err && <ErrorBar msg={err} />}
      {saved && <p className="rounded-xl bg-black px-4 py-3 text-sm font-semibold text-white">{t("admin.settingsSaved")}</p>}
      <div className="wl-card p-5">
        <h3 className="mb-4 font-display text-2xl">{t("admin.settings")}</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {num("registrationHours", t("admin.regHours"))}
          {num("gameDays", t("admin.gameDays"))}
          {num("guessingHours", t("admin.guessingHours"))}
          {num("messageMaxLength", t("admin.msgLimit"))}
          {num("messageRatePerHour", t("admin.msgRate"))}
          {num("minParticipants", t("admin.minParticipants"))}
          {num("retentionDays", t("admin.retention"))}
          {num("reminderCloseHours", "Rappel avant fermeture (h)")}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {bool("aiModerationEnabled", t("admin.aiEnabled"))}
          {bool("whatsappTestMode", t("admin.waTestMode"))}
          {bool("autoTransitions", t("admin.autoTransitions"))}
          {bool("missionsEnabled", t("admin.missionsEnabled"))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="set-catA">{t("admin.catALabel")}</Label>
            <Input id="set-catA" className="mt-1.5" value={String(s.categoryALabel ?? "")} onChange={(e) => setForm({ ...s, categoryALabel: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="set-catB">{t("admin.catBLabel")}</Label>
            <Input id="set-catB" className="mt-1.5" value={String(s.categoryBLabel ?? "")} onChange={(e) => setForm({ ...s, categoryBLabel: e.target.value })} />
          </div>
        </div>
        <Button onClick={save} disabled={mutation.isPending || !form} className="mt-5 rounded-full bg-black px-8 hover:bg-black/85">
          {t("common.save")}
        </Button>
      </div>
    </div>
  );
}

// ── Integrations ──

function IntegrationsTab() {
  const { t } = useI18n();
  const q = useQuery({
    queryKey: ["admin-integrations"],
    queryFn: () =>
      api<{
        integrations: { id: string; name: string; status: string; detail: string; missing?: string[]; env?: string[]; webhookUrl?: string; lastRun?: string | null }[];
      }>("/api/admin/integrations"),
  });
  const [testResult, setTestResult] = useState<string | null>(null);
  const testMutation = useMutation({
    mutationFn: () => api<{ ok: boolean; status: string; missing?: string[]; error?: string }>("/api/admin/integrations", { method: "POST", body: {} }),
    onSuccess: (d) =>
      setTestResult(d.ok ? t("admin.integrations.testOk") : `${d.status}${d.missing ? ` — ${d.missing.join(", ")}` : ""}${d.error ? ` — ${d.error}` : ""}`),
  });

  if (q.isLoading) return <Spinner />;

  const badgeFor = (status: string) => {
    const map: Record<string, { c: string; l: string }> = {
      OPERATIONAL: { c: "bg-black text-white", l: t("admin.integrations.configured") },
      NOT_CONFIGURED: { c: "border border-dashed border-black/40 text-black/50", l: t("admin.integrations.notConfigured") },
      PARTIAL: { c: "bg-amber-100 text-amber-800", l: "Partiel" },
      FILTERS_ONLY: { c: "bg-amber-100 text-amber-800", l: "Filtres seuls" },
    };
    const b = map[status] ?? map.NOT_CONFIGURED;
    return <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${b.c}`}>{b.l}</span>;
  };

  return (
    <div className="mt-4 space-y-4">
      <div className="wl-card p-5">
        <h3 className="mb-4 flex items-center gap-2 font-display text-2xl"><Activity className="h-5 w-5" /> {t("admin.integrations.health")}</h3>
        <div className="space-y-3">
          {q.data!.integrations.map((i) => (
            <div key={i.id} className="rounded-2xl border border-black/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">{i.name}</p>
                {badgeFor(i.status)}
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-black/55">{i.detail}</p>
              {i.missing && i.missing.length > 0 && (
                <p className="mt-2 font-mono text-[11px] text-red-600">Manquants : {i.missing.join(", ")}</p>
              )}
              {i.env && (
                <div className="mt-2">
                  <p className="text-[11px] font-semibold text-black/50">{t("admin.integrations.howTo")}</p>
                  <ul className="mt-1 space-y-0.5">
                    {i.env.map((e) => (
                      <li key={e} className="font-mono text-[11px] text-black/60">{e}</li>
                    ))}
                  </ul>
                </div>
              )}
              {i.webhookUrl && <p className="mt-2 font-mono text-[11px] text-black/60">Webhook : {i.webhookUrl}</p>}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={() => testMutation.mutate()} disabled={testMutation.isPending} className="rounded-full">
            <RefreshCw className="h-4 w-4" /> {t("admin.integrations.test")}
          </Button>
          {testResult && <p className="text-xs font-semibold">{testResult}</p>}
        </div>
      </div>
    </div>
  );
}

// ── Audit ──

function AuditTab() {
  const { lang } = useI18n();
  const q = useQuery({
    queryKey: ["admin-audit"],
    queryFn: () =>
      api<{ logs: { id: string; actorName: string; action: string; target: string | null; meta: string | null; createdAt: string }[] }>("/api/admin/audit?take=150"),
    refetchInterval: 20000,
  });
  if (q.isLoading) return <Spinner />;
  const logs = q.data?.logs ?? [];
  return (
    <div className="wl-card mt-4 overflow-hidden">
      <div className="max-h-[70vh] overflow-auto wl-scroll">
        {logs.length === 0 ? (
          <p className="p-8 text-center text-sm text-black/40">{t("admin.auditEmpty")}</p>
        ) : (
          <table className="w-full min-w-[640px] text-sm">
            <thead className="sticky top-0 bg-neutral-50 text-[11px] uppercase tracking-wider text-black/50">
              <tr>
                <th className="px-4 py-3 text-start font-semibold">Date</th>
                <th className="px-3 py-3 text-start font-semibold">Acteur</th>
                <th className="px-3 py-3 text-start font-semibold">Action</th>
                <th className="px-3 py-3 text-start font-semibold">Cible</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/5">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-neutral-50/60">
                  <td className="whitespace-nowrap px-4 py-2.5 text-xs text-black/60">{formatDate(l.createdAt, lang)}</td>
                  <td className="px-3 py-2.5 text-xs font-medium">{l.actorName}</td>
                  <td className="px-3 py-2.5">
                    <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-mono text-[11px]">{l.action}</span>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[10px] text-black/40">{l.target ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function ErrorBar({ msg }: { msg: string }) {
  return (
    <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      <CircleAlert className="h-4 w-4 shrink-0" /> {msg}
    </p>
  );
}
