"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Ban, CircleAlert, Flag, Heart, Lock, Send, ShieldAlert, Timer, UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError, type InboxData, type InboxMessage } from "./api";
import { useI18n } from "./i18n-context";
import { Spinner, formatTime } from "./shared";

export function MessagesPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  // null = "auto": derive the initial tab from unread messages
  const [tabChoice, setTabChoice] = useState<"friend" | "admirer" | null>(null);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [reportFor, setReportFor] = useState<InboxMessage | null>(null);
  const [reportReason, setReportReason] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const inboxQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => api<InboxData>("/api/me/inbox"),
    refetchInterval: () => {
      // PERFORMANCE: poll only while the tab is visible — a hidden tab no
      // longer generates requests (or DB load) every few seconds.
      return typeof document !== "undefined" && document.hidden ? false : 6000;
    },
  });

  // Mark messages as read ONLY when the message center is open and visible
  // (fix: the old polling GET wrote to the DB every 5 s per user and cleared
  // unread badges before the user actually saw the messages).
  const totalUnread =
    (inboxQuery.data?.threads?.friend.messages ?? []).filter((m) => !m.mine && !m.readAt).length +
    (inboxQuery.data?.threads?.admirer.messages ?? []).filter((m) => !m.mine && !m.readAt).length;
  useEffect(() => {
    if (totalUnread === 0) return;
    if (typeof document !== "undefined" && document.hidden) return;
    const timer = setTimeout(() => {
      api("/api/me/inbox", { method: "POST" })
        .then(() => qc.invalidateQueries({ queryKey: ["inbox"] }))
        .catch(() => {});
    }, 1200); // small delay: the user must actually see the thread
    return () => clearTimeout(timer);
  }, [totalUnread, qc]);

  const sendMutation = useMutation({
    mutationFn: (payload: { destination: string; body: string }) =>
      api("/api/me/messages", { method: "POST", body: payload }),
    onSuccess: (_data, payload) => {
      setDraft("");
      setFeedback(null);
      qc.invalidateQueries({ queryKey: ["inbox"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      if (payload.destination === "admirer") setTabChoice("admirer");
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const map: Record<string, string> = {
          RATE_LIMITED: t("msg.rateLimited"),
          NOT_ELIGIBLE: t("dash.notRegistered"),
          NO_ASSIGNMENT: t("msg.block.NO_ASSIGNMENT"),
          REJECTED_BY_MODERATION: t("common.error"),
          RESTRICTED: t("msg.block.RESTRICTED"),
          EMPTY: t("common.error"),
          TOO_LONG: t("common.error"),
        };
        // Prefer the server's human-safe French message when present.
        const serverMessage =
          e.code === "REJECTED_BY_MODERATION" && e.payload?.message
            ? String(e.payload.message)
            : undefined;
        setFeedback({
          kind: "error",
          text: serverMessage ?? map[e.code] ?? `${t("common.error")} (${e.code})`,
        });
      } else {
        setFeedback({ kind: "error", text: t("common.error") });
      }
    },
  });

  const reportMutation = useMutation({
    mutationFn: (payload: { messageId: string; reason: string }) =>
      api("/api/me/messages/report", { method: "POST", body: payload }),
    onSuccess: () => {
      setReportFor(null);
      setReportReason("");
      qc.invalidateQueries({ queryKey: ["inbox"] });
    },
  });

  const data = inboxQuery.data;
  // Derive the active tab (auto-switch to admirer thread when unread there)
  const autoTab: "friend" | "admirer" =
    data?.threads &&
    data.threads.admirer.messages.some((m) => !m.mine && !m.readAt) &&
    !data.threads.friend.messages.some((m) => !m.mine && !m.readAt)
      ? "admirer"
      : "friend";
  const tab = tabChoice ?? autoTab;
  const thread = data?.threads ? data.threads[tab] : null;
  const messages = thread?.messages ?? [];
  const maxLength = data?.round?.messageMaxLength ?? 500;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, tab]);

  const canSend = data?.canSend && thread?.exists && !data.revealed;
  const friendUnread = useMemo(
    () => (data?.threads?.friend.messages ?? []).filter((m) => !m.mine && !m.readAt).length,
    [data]
  );
  const admirerUnread = useMemo(
    () => (data?.threads?.admirer.messages ?? []).filter((m) => !m.mine && !m.readAt).length,
    [data]
  );

  if (inboxQuery.isLoading) return <Spinner />;
  if (!data?.threads) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-20 text-center">
          <Lock className="mx-auto h-10 w-10 text-black/30" />
          <p className="mt-4 font-display text-3xl">{t("dash.noRound")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1">
      <div className="mx-auto flex h-[calc(100dvh-4rem)] max-w-3xl flex-col px-4 sm:px-6">
        <div className="pt-6 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="font-display text-4xl leading-none">{t("msg.title")}</h1>
          </div>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-black/50">
            <ShieldAlert className="h-3.5 w-3.5" /> {t("msg.anonymity")}
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTabChoice(v as "friend" | "admirer")} className="mt-2">
          <TabsList className="grid w-full grid-cols-2 rounded-full bg-neutral-100 p-1">
            <TabsTrigger value="friend" className="rounded-full text-xs sm:text-sm">
              {t("msg.tabFriend")}
              {friendUnread > 0 && <span className="ms-1.5 rounded-full bg-black px-1.5 text-[10px] font-bold text-white">{friendUnread}</span>}
            </TabsTrigger>
            <TabsTrigger value="admirer" className="rounded-full text-xs sm:text-sm">
              {t("msg.tabAdmirer")}
              {admirerUnread > 0 && <span className="ms-1.5 rounded-full bg-black px-1.5 text-[10px] font-bold text-white">{admirerUnread}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Thread */}
        <div className="mt-4 flex-1 overflow-y-auto wl-scroll pe-1">
          {!thread?.exists ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Ban className="h-8 w-8 text-black/25" />
              <p className="mt-3 max-w-xs text-sm text-black/50">
                {tab === "friend" ? t("msg.emptyFriend") : t("msg.emptyAdmirer")}
              </p>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <Heart className="h-8 w-8 text-black/25" />
              <p className="mt-3 max-w-xs text-sm text-black/50">
                {tab === "friend" ? t("msg.emptyFriend") : t("msg.emptyAdmirer")}
              </p>
            </div>
          ) : (
            <div className="space-y-3 pb-4">
              {messages.map((m) => (
                <motion.div
                  key={m.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`group flex flex-col ${m.mine ? "items-end" : "items-start"}`}
                >
                  <div
                    className={`relative max-w-[85%] rounded-2xl px-4 py-3 ${
                      m.mine ? "rounded-ee-sm bg-black text-white" : "rounded-ss-sm border border-black/10 bg-white"
                    }`}
                  >
                    <p className={`mb-1 text-[10px] font-bold uppercase tracking-widest ${m.mine ? "text-white/50" : "text-black/40"}`}>
                      {m.mine ? t("msg.you") : tab === "admirer" ? t("msg.fromAdmirer") : t("msg.fromFriend")}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.body}</p>
                    <div className={`mt-1.5 flex items-center gap-2 text-[10px] ${m.mine ? "text-white/50" : "text-black/40"}`}>
                      <span>{formatTime(m.createdAt, lang)}</span>
                      {m.mine && (
                        <span className={`rounded-full px-1.5 py-0.5 font-semibold ${m.modStatus === "ALLOWED" ? "bg-white/15" : m.modStatus === "REJECTED" ? "bg-red-500/20 text-red-200" : "bg-amber-400/20 text-amber-100"}`}>
                          {t(`msg.status.${m.modStatus}` as never)}
                        </span>
                      )}
                      {m.mine && m.deliveryStatus && m.modStatus === "ALLOWED" && m.deliveryStatus !== "SENT" && (
                        <span className="rounded-full bg-white/15 px-1.5 py-0.5 font-semibold">
                          {t(`msg.delivery.${m.deliveryStatus}` as never)}
                        </span>
                      )}
                      <button
                        onClick={() => setReportFor(m)}
                        className="opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
                        aria-label={t("msg.report")}
                      >
                        <Flag className="h-3 w-3" />
                      </button>
                    </div>
                    {m.mine && m.modStatus === "REJECTED" && m.modExplanation && (
                      <p className="mt-2 rounded-lg bg-red-500/15 px-2.5 py-1.5 text-[11px] leading-snug text-red-100">
                        {t("msg.rejectedNote")} {m.modExplanation}
                      </p>
                    )}
                  </div>
                </motion.div>
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 border-t border-black/10 bg-background/95 py-3 backdrop-blur">
          {feedback && (
            <p className={`mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium ${feedback.kind === "error" ? "bg-red-50 text-red-700" : "bg-neutral-100 text-black/70"}`}>
              <CircleAlert className="h-3.5 w-3.5 shrink-0" /> {feedback.text}
            </p>
          )}
          {canSend ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!draft.trim()) return;
                sendMutation.mutate({ destination: tab, body: draft });
              }}
            >
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
                    placeholder={t("msg.placeholder")}
                    className="min-h-11 resize-none rounded-2xl py-3"
                    rows={1}
                    aria-label={t("msg.placeholder")}
                  />
                </div>
                <Button type="submit" size="icon" disabled={!draft.trim() || sendMutation.isPending} className="h-11 w-11 shrink-0 rounded-full bg-black hover:bg-black/85" aria-label={t("msg.send")}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="mt-1 flex items-center justify-between px-1 text-[10px] text-black/40">
                <span className="inline-flex items-center gap-1">
                  <UserRound className="h-3 w-3" />
                  {tab === "friend" ? t("msg.writeToFriend") : t("msg.replyToAdmirer")}
                </span>
                <span className="tabular-nums">
                  {maxLength - draft.length} {t("msg.charsLeft")}
                </span>
              </div>
            </form>
          ) : (
            <p className="flex items-center justify-center gap-2 py-3 text-center text-xs text-black/50">
              <Timer className="h-3.5 w-3.5" />
              {data.sendBlockReason
                ? t(`msg.block.${data.sendBlockReason}` as never)
                : data.revealed
                  ? t("status.revealed")
                  : t("dash.noRound")}
            </p>
          )}
        </div>
      </div>

      {/* Report dialog */}
      <Dialog open={!!reportFor} onOpenChange={(v) => !v && setReportFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Flag className="h-4 w-4" /> {t("msg.report")}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium text-black/70">{t("msg.reportReason")}</p>
          <Textarea
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
            className="min-h-24"
            placeholder={t("msg.reportReason")}
          />
          <DialogFooter>
            <Button
              onClick={() => reportFor && reportMutation.mutate({ messageId: reportFor.id, reason: reportReason })}
              disabled={reportReason.trim().length < 3 || reportMutation.isPending}
              className="w-full rounded-full bg-black hover:bg-black/85"
            >
              {reportMutation.isPending ? t("common.loading") : t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
