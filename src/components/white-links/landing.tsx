"use client";

import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  UserRoundPlus, HeartHandshake, HelpCircle, Sparkles, ShieldCheck, Eye, EyeOff,
  MessageCircleHeart, Gift, ChevronDown, ArrowRight, Mail, Clock, Users, Lock, Send,
} from "lucide-react";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { EnvelopeArt, Countdown, StatusPill, SectionTitle, Spinner } from "./shared";
import { useI18n } from "./i18n-context";
import { api, type CurrentStatus, type Me } from "./api";
import { MISSIONS } from "@/lib/missions";

export function Landing({ me }: { me: Me | null }) {
  const { t, lang } = useI18n();
  const statusQuery = useQuery({
    queryKey: ["public-status"],
    queryFn: () => api<CurrentStatus>("/api/rounds/current"),
    refetchInterval: 30000,
  });

  const round = statusQuery.data?.round ?? null;

  const countdownTarget =
    round?.status === "registration_open"
      ? round.registrationEnd
      : round?.status === "registration_closed" || round?.status === "matching_pending"
        ? round.registrationEnd
        : round?.status === "active" || round?.status === "guessing_open"
          ? round.revealAt ?? round.gameEnd
          : statusQuery.data?.nextRound?.registrationStart ?? null;

  const countdownLabel =
    round?.status === "registration_open"
      ? t("status.countdown.close")
      : round?.status === "registration_closed" || round?.status === "matching_pending"
        ? t("status.countdown.start")
        : round?.status === "active" || round?.status === "guessing_open"
          ? t("status.countdown.reveal")
          : t("status.countdown.nextReg");

  return (
    <main className="flex-1">
      {/* ── Hero ── */}
      <section className="relative overflow-hidden wl-hero-grid">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 py-16 sm:py-24 lg:grid-cols-2">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.4, 0, 0.2, 1] }}
          >
            <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-black/15 bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-[0.2em]">
              <Sparkles className="h-3.5 w-3.5" />
              {t("hero.badge")}
            </p>
            <h1 className="font-display text-6xl sm:text-7xl lg:text-8xl leading-[0.9]">
              {t("hero.title1")}
              <br />
              <span className="relative inline-block">
                {t("hero.title2")}
                <svg className="absolute -bottom-2 start-0 w-full" height="8" viewBox="0 0 200 8" preserveAspectRatio="none" aria-hidden="true">
                  <path d="M2 6 Q 100 -2 198 6" stroke="black" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </span>
            </h1>
            <p className="mt-6 max-w-lg text-base sm:text-lg leading-relaxed text-black/70">
              {t("hero.desc")}
            </p>
            <p className="mt-2 text-sm font-semibold italic text-black/50">« {t("brand.tagline")} »</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {me ? (
                <Button size="lg" onClick={() => (window.location.hash = "/white-links/dashboard")} className="h-12 rounded-full bg-black px-8 text-base hover:bg-black/85">
                  {t("nav.dashboard")} <ArrowRight className="ms-2 h-4 w-4" />
                </Button>
              ) : (
                <Button size="lg" onClick={() => (window.location.hash = "/white-links/register")} className="h-12 rounded-full bg-black px-8 text-base hover:bg-black/85">
                  {t("hero.cta")} <ArrowRight className="ms-2 h-4 w-4" />
                </Button>
              )}
              <a href="#how" className="inline-flex h-12 items-center rounded-full border border-black/20 px-6 text-sm font-semibold hover:bg-black hover:text-white transition-colors">
                {t("hero.cta2")}
              </a>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15, ease: [0.4, 0, 0.2, 1] }}
            className="relative mx-auto w-full max-w-md"
          >
            <div className="wl-float">
              <EnvelopeArt className="w-full drop-shadow-sm" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Live status ── */}
      <section className="border-y border-black/10 bg-white">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
          {statusQuery.isLoading ? (
            <Spinner />
          ) : !round ? (
            <div className="wl-card p-6 sm:p-8 flex flex-col sm:flex-row items-start sm:items-center gap-5 justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-black/50" />
                  <h3 className="font-display text-2xl">{t("status.setup")}</h3>
                </div>
                <p className="mt-2 text-sm text-black/60 max-w-xl leading-relaxed">{t("status.setupDesc")}</p>
              </div>
            </div>
          ) : (
            <div className="wl-card p-6 sm:p-8">
              <div className="flex flex-col lg:flex-row lg:items-center gap-6 justify-between">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusPill status={round.status} />
                    <span className="text-sm text-black/50 font-medium">
                      {t("status.round")} — {round.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-sm text-black/60">
                    <span className="inline-flex items-center gap-1.5">
                      <Users className="h-4 w-4" /> {round.participantCount ?? 0} {t("status.participants")}
                    </span>
                    {round.registrationStart && (
                      <span className="inline-flex items-center gap-1.5">
                        <Clock className="h-4 w-4" />
                        {new Date(round.registrationStart).toLocaleDateString(lang === "ar" ? "ar-TN" : "fr-FR", { timeZone: "Africa/Tunis", day: "numeric", month: "short" })}
                        {" → "}
                        {new Date((round.gameEnd ?? round.registrationEnd)).toLocaleDateString(lang === "ar" ? "ar-TN" : "fr-FR", { timeZone: "Africa/Tunis", day: "numeric", month: "short" })}
                      </span>
                    )}
                    {round.matchingMode === "CROSS_CATEGORY" && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs font-semibold">
                        <Eye className="h-3.5 w-3.5" /> Fille ↔ Garçon
                      </span>
                    )}
                  </div>
                </div>
                <div>
                  <Countdown targetIso={countdownTarget} prefix={countdownLabel} />
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24 scroll-mt-20">
        <SectionTitle kicker="3 étapes">{t("how.title")}</SectionTitle>
        <div className="grid gap-5 md:grid-cols-3">
          {[
            { icon: UserRoundPlus, title: t("how.s1t"), desc: t("how.s1d"), num: "01" },
            { icon: HeartHandshake, title: t("how.s2t"), desc: t("how.s2d"), num: "02" },
            { icon: HelpCircle, title: t("how.s3t"), desc: t("how.s3d"), num: "03" },
          ].map((s, i) => (
            <motion.div
              key={s.num}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.5, delay: i * 0.1 }}
              className="wl-card group relative overflow-hidden p-6 hover:shadow-lg transition-shadow"
            >
              <span className="absolute end-4 top-3 font-display text-6xl text-black/[0.06] select-none">{s.num}</span>
              <div className="mb-4 inline-flex rounded-2xl bg-black p-3 text-white">
                <s.icon className="h-5 w-5" />
              </div>
              <h3 className="font-display text-2xl">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-black/60">{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Messaging preview ── */}
      <section className="bg-black text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 py-16 sm:py-24 lg:grid-cols-2">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/50 mb-2">Anonymat total</p>
            <h2 className="font-display text-4xl sm:text-5xl leading-[0.95]">{t("messages.preview.title")}</h2>
            <p className="mt-4 max-w-md text-base leading-relaxed text-white/70">{t("messages.preview.desc")}</p>
            <ul className="mt-6 space-y-3 text-sm text-white/80">
              <li className="flex items-center gap-3"><EyeOff className="h-4 w-4 shrink-0" /> Aucun nom, aucun numéro — jamais.</li>
              <li className="flex items-center gap-3"><ShieldCheck className="h-4 w-4 shrink-0" /> Modération automatique + humaine du club.</li>
              <li className="flex items-center gap-3"><Send className="h-4 w-4 shrink-0" /> Depuis le site ou via WhatsApp avec les commandes 1 &amp; 2.</li>
            </ul>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mx-auto w-full max-w-md space-y-3"
            aria-hidden="true"
          >
            <div className="rounded-2xl rounded-ee-sm bg-white/10 backdrop-blur px-5 py-4 max-w-[85%]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Ton admirateur secret</p>
              <p className="text-sm leading-relaxed"> Courage pour tes partiels cette semaine ! Tu vas tout déchirer 💪 </p>
            </div>
            <div className="rounded-2xl rounded-ss-sm bg-white text-black px-5 py-4 max-w-[85%] ms-auto">
              <p className="text-[10px] font-bold uppercase tracking-widest text-black/40 mb-1">Toi</p>
              <p className="text-sm leading-relaxed"> Merci mystère… tu illumines mes journées de révisions ✨ </p>
            </div>
            <div className="rounded-2xl rounded-ee-sm bg-white/10 backdrop-blur px-5 py-4 max-w-[85%]">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/50 mb-1">Ton admirateur secret</p>
              <p className="text-sm leading-relaxed"> Petit indice : je suis dans le même amphi que toi 😏 </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Missions ── */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-24">
        <SectionTitle kicker="Chaque jour">{t("missions.title")}</SectionTitle>
        <p className="-mt-4 mb-8 max-w-2xl text-sm leading-relaxed text-black/60">{t("missions.desc")}</p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MISSIONS.slice(0, 6).map((m, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, scale: 0.97 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4, delay: i * 0.06 }}
              className="wl-card flex items-start gap-4 p-5"
            >
              <div className="rounded-xl border border-black/10 bg-neutral-50 p-2.5">
                <Gift className="h-4 w-4" />
              </div>
              <p className="text-sm font-medium leading-relaxed">{lang === "ar" ? m.ar : m.fr}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Rules & privacy ── */}
      <section id="rules" className="border-y border-black/10 bg-neutral-50 scroll-mt-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 py-16 sm:py-20">
          <SectionTitle kicker="Jeu sûr &amp; respectueux">{t("rules.title")}</SectionTitle>
          <div className="grid gap-4 md:grid-cols-2">
            {[
              { icon: EyeOff, text: t("rules.r1") },
              { icon: ShieldCheck, text: t("rules.r2") },
              { icon: Lock, text: t("rules.r3") },
              { icon: HeartHandshake, text: t("rules.r4") },
              { icon: UserRoundPlus, text: t("rules.r5") },
            ].map((r, i) => (
              <div key={i} className="flex items-start gap-3 rounded-2xl border border-black/10 bg-white p-4">
                <r.icon className="mt-0.5 h-4.5 w-4.5 h-5 w-5 shrink-0 text-black/70" />
                <p className="text-sm leading-relaxed text-black/80">{r.text}</p>
              </div>
            ))}
            <div className="rounded-2xl border border-black/10 bg-black p-4 text-white md:col-span-1">
              <p className="mb-1.5 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
                <Lock className="h-3.5 w-3.5" /> {t("rules.privacy")}
              </p>
              <p className="text-xs leading-relaxed text-white/75">{t("common.privacyText")}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="mx-auto max-w-3xl px-4 sm:px-6 py-16 sm:py-24 scroll-mt-20">
        <SectionTitle kicker="Tout savoir">{t("faq.title")}</SectionTitle>
        <Accordion type="single" collapsible className="wl-card px-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <AccordionItem key={i} value={`q${i}`}>
              <AccordionTrigger className="text-start text-sm sm:text-base font-semibold hover:no-underline">
                {t(`faq.q${i}` as never)}
              </AccordionTrigger>
              <AccordionContent className="text-sm leading-relaxed text-black/65">
                {t(`faq.a${i}` as never)}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>

      {/* ── Final CTA ── */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6 pb-20">
        <div className="relative overflow-hidden rounded-[2rem] bg-black px-6 py-14 sm:py-16 text-center text-white">
          <EnvelopeArt className="absolute -end-10 -top-6 w-64 opacity-[0.08] rotate-12" />
          <EnvelopeArt className="absolute -start-12 -bottom-10 w-64 opacity-[0.08] -rotate-12" />
          <Mail className="mx-auto mb-5 h-8 w-8" />
          <h2 className="font-display text-5xl sm:text-6xl leading-[0.9]">{t("hero.title1")} {t("hero.title2")}</h2>
          <p className="mx-auto mt-4 max-w-md text-sm text-white/70">{t("brand.tagline")}</p>
          <Button
            size="lg"
            onClick={() => (window.location.hash = me ? "/white-links/dashboard" : "/white-links/register")}
            className="mt-8 h-12 rounded-full bg-white px-8 text-base font-semibold text-black hover:bg-white/90"
          >
            {me ? t("nav.dashboard") : t("hero.cta")}
            <ArrowRight className="ms-2 h-4 w-4" />
          </Button>
        </div>
      </section>
    </main>
  );
}
