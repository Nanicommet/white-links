"use client";

import React, { useEffect, useState, useRef } from "react";
import { useI18n } from "./i18n-context";
import { formatDate, formatTime } from "@/lib/i18n";

// Re-export date formatters so views can import them from ./shared
export { formatDate, formatTime };

// ── Hash router (single-route SPA constraint) ──

export function useHashRoute(): { path: string; navigate: (p: string) => void } {
  const [path, setPath] = useState(() => {
    if (typeof window === "undefined") return "/";
    const h = window.location.hash.replace(/^#/, "");
    return h || "/";
  });
  useEffect(() => {
    const onChange = () => {
      setPath(window.location.hash.replace(/^#/, "") || "/");
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const navigate = (p: string) => {
    window.location.hash = p;
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  };
  return { path, navigate };
}

// ── Brand logo / wordmark ──

export function Wordmark({ light = false, compact = false }: { light?: boolean; compact?: boolean }) {
  return (
    <span className={`inline-flex items-baseline gap-2 select-none ${light ? "text-white" : "text-black"}`}>
      <span className="font-display text-2xl leading-none tracking-wide">WHITE</span>
      <span
        className={`font-display text-2xl leading-none tracking-wide px-1.5 rounded-sm ${light ? "bg-white text-black" : "bg-black text-white"}`}
      >
        LINKS
      </span>
      {!compact && (
        <span className={`hidden sm:inline text-[10px] uppercase tracking-[0.2em] font-medium ${light ? "text-white/70" : "text-black/50"}`}>
          · WLC ISSIG
        </span>
      )}
    </span>
  );
}

// ── Elegant monochrome envelope illustration (SVG line art) ──

export function EnvelopeArt({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 200" fill="none" className={className} aria-hidden="true">
      <rect x="30" y="60" width="180" height="110" rx="10" className="stroke-black" strokeWidth="2.5" />
      <path d="M30 70 L120 135 L210 70" className="stroke-black" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 165 L95 112 M210 165 L145 112" className="stroke-black/30" strokeWidth="2" strokeLinecap="round" />
      <circle cx="120" cy="52" r="16" className="fill-black" />
      <path d="M113 52l5 5 9-10" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M60 30c4-8 14-8 18 0M158 22c4-8 14-8 18 0M186 44c3-6 11-6 14 0" className="stroke-black/25" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="42" cy="42" r="2.5" className="fill-black/30" />
      <circle cx="205" cy="60" r="2.5" className="fill-black/30" />
      <circle cx="60" cy="185" r="2" className="fill-black/20" />
    </svg>
  );
}

// ── Live countdown to an ISO date ──

export function useCountdown(targetIso: string | null | undefined) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [targetIso]);
  if (!targetIso) return null;
  const diff = new Date(targetIso).getTime() - now;
  if (diff <= 0) return { past: true, days: 0, hours: 0, minutes: 0, seconds: 0 };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { past: false, days, hours, minutes, seconds };
}

export function Countdown({ targetIso, prefix, dark = false, compact = false }: { targetIso: string | null | undefined; prefix?: string; dark?: boolean; compact?: boolean }) {
  const { t, lang } = useI18n();
  const cd = useCountdown(targetIso);
  if (!cd) return null;
  const box = (v: number, label: string) => (
    <div
      key={label}
      className={`flex flex-col items-center justify-center rounded-xl px-2.5 py-2 min-w-[62px] ${dark ? "bg-white/10 text-white" : "bg-black text-white"}`}
    >
      <span className="font-display text-2xl leading-none tabular-nums">
        {String(v).padStart(2, "0")}
      </span>
      <span className={`text-[10px] uppercase tracking-widest mt-1 ${dark ? "text-white/70" : "text-white/70"}`}>
        {label}
      </span>
    </div>
  );
  const label = cd.days === 1 ? t("day") : t("days");
  return (
    <div className="flex flex-wrap items-center gap-2">
      {prefix && <span className={`text-sm font-medium ${dark ? "text-white/80" : "text-black/70"}`}>{prefix}</span>}
      {cd.past ? (
        <span className={`text-sm font-semibold ${dark ? "text-white" : "text-black"}`}>—</span>
      ) : (
        <div className="flex items-center gap-1.5" aria-label={prefix}>
          {cd.days > 0 && box(cd.days, label)}
          {box(cd.hours, t("h"))}
          {box(cd.minutes, t("min"))}
          {!compact && box(cd.seconds, t("s"))}
        </div>
      )}
      <span className="sr-only">{targetIso ? formatDate(targetIso, lang) : ""}</span>
    </div>
  );
}

// ── Round status pill ──

export function StatusPill({ status }: { status: string }) {
  const { t } = useI18n();
  const key: Record<string, string> = {
    draft: "status.setup",
    registration_open: "status.registration_open",
    registration_closed: "status.registration_closed",
    matching_pending: "status.matching_pending",
    active: "status.active",
    guessing_open: "status.guessing_open",
    revealed: "status.revealed",
    archived: "status.archived",
  };
  const styles: Record<string, string> = {
    registration_open: "bg-white border-black text-black",
    active: "bg-black text-white border-black",
    guessing_open: "bg-black text-white border-black",
    revealed: "bg-white border-black/40 text-black",
    default: "bg-neutral-100 border-neutral-300 text-neutral-700",
  };
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${styles[status] ?? styles.default}`}>
        {(status === "registration_open" || status === "active" || status === "guessing_open") && (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-current opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-current" />
          </span>
        )}
        {t((key[status] ?? "status.setup") as never)}
      </span>
    </span>
  );
}

// ── Section heading (display font) ──

export function SectionTitle({ children, kicker }: { children: React.ReactNode; kicker?: string }) {
  return (
    <div className="mb-8">
      {kicker && (
        <p className="text-xs font-bold uppercase tracking-[0.25em] text-black/50 mb-2">{kicker}</p>
      )}
      <h2 className="font-display text-4xl sm:text-5xl leading-[0.95]">{children}</h2>
    </div>
  );
}

// ── Spinner ──

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center py-16 ${className}`} role="status" aria-live="polite">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-black/15 border-t-black" />
      <span className="sr-only">Chargement…</span>
    </div>
  );
}

// ── Confetti (monochrome, restrained) ──

export function Confetti({ active }: { active: boolean }) {
  const pieces = useRef(
    Array.from({ length: 40 }, (_, i) => ({
      left: Math.random() * 100,
      delay: Math.random() * 1.5,
      duration: 2.5 + Math.random() * 2,
      shade: i % 3 === 0 ? "#a3a3a3" : i % 3 === 1 ? "#000" : "#d4d4d4",
    }))
  ).current;
  if (!active) return null;
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-50" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          className="wl-confetti-piece"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            background: p.shade,
          }}
        />
      ))}
    </div>
  );
}
