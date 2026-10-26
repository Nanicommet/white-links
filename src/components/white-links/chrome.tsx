"use client";

import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Menu, X, Globe, LayoutDashboard, LogIn, LogOut, ShieldCheck, ExternalLink, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Wordmark, useHashRoute } from "./shared";
import { useI18n } from "./i18n-context";
import { formatDate } from "@/lib/i18n";
import { api, type Me, type NotificationItem } from "./api";

export function Header({ me }: { me: Me | null }) {
  const { t, lang, setLang } = useI18n();
  const { path, navigate } = useHashRoute();
  const [open, setOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const qc = useQueryClient();

  const notifQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: NotificationItem[]; unread: number }>("/api/me/notifications"),
    enabled: !!me,
    refetchInterval: 20000,
  });

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    await qc.invalidateQueries();
    navigate("/");
  };

  const markAllRead = async () => {
    await api("/api/me/notifications", { method: "POST" });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const navItems = (
    <>
      <a href="#how" onClick={() => setOpen(false)} className="text-sm font-medium text-black/70 hover:text-black transition-colors wl-link-underline">
        {t("nav.how")}
      </a>
      <a href="#rules" onClick={() => setOpen(false)} className="text-sm font-medium text-black/70 hover:text-black transition-colors wl-link-underline">
        {t("nav.rules")}
      </a>
      <a href="#faq" onClick={() => setOpen(false)} className="text-sm font-medium text-black/70 hover:text-black transition-colors wl-link-underline">
        {t("nav.faq")}
      </a>
      <a href="https://whitelineissig.me/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-black/70 hover:text-black transition-colors wl-link-underline">
        {t("nav.clubSite")} <ExternalLink className="h-3.5 w-3.5" />
      </a>
    </>
  );

  const unread = notifQuery.data?.unread ?? 0;

  return (
    <header className="sticky top-0 z-40 border-b border-black/10 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
        <button onClick={() => navigate("/")} aria-label="WHITE LINKS — accueil" className="flex items-center">
          <Wordmark />
        </button>

        <nav className="hidden md:flex items-center gap-6">{navItems}</nav>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setLang(lang === "fr" ? "ar" : "fr")}
            className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-black/15 px-3 py-1.5 text-xs font-semibold hover:bg-black hover:text-white transition-colors"
            aria-label={lang === "fr" ? "العربية" : "Français"}
          >
            <Globe className="h-3.5 w-3.5" />
            {lang === "fr" ? "العربية" : "FR"}
          </button>

          {me && (
            <div className="relative">
              <button
                onClick={() => setNotifOpen((v) => !v)}
                className="relative rounded-full border border-black/15 p-2 hover:bg-black hover:text-white transition-colors"
                aria-label={t("notif.title")}
              >
                <Bell className="h-4 w-4" />
                {unread > 0 && (
                  <span className="absolute -top-1 -end-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
              {notifOpen && (
                <div className="absolute end-0 mt-2 w-80 max-w-[85vw] rounded-2xl border border-black/10 bg-white shadow-xl p-2 z-50">
                  <div className="flex items-center justify-between px-2 py-1.5">
                    <p className="text-sm font-bold">{t("notif.title")}</p>
                    {unread > 0 && (
                      <button onClick={markAllRead} className="text-xs font-medium text-black/60 hover:text-black underline">
                        {t("notif.markRead")}
                      </button>
                    )}
                  </div>
                  <div className="max-h-80 overflow-y-auto wl-scroll">
                    {(notifQuery.data?.notifications ?? []).length === 0 ? (
                      <p className="px-3 py-6 text-center text-sm text-black/50">{t("notif.empty")}</p>
                    ) : (
                      notifQuery.data!.notifications.map((n) => (
                        <div key={n.id} className={`rounded-xl px-3 py-2.5 ${!n.read ? "bg-neutral-100" : ""}`}>
                          <p className="text-sm font-semibold leading-snug">{n.title}</p>
                          <p className="text-xs text-black/60 mt-0.5 leading-relaxed">{n.body}</p>
                          <p className="text-[10px] text-black/40 mt-1">{formatDate(n.createdAt, lang)}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {me ? (
            <div className="hidden sm:flex items-center gap-2">
              <Button onClick={() => navigate("/white-links/dashboard")} size="sm" className="rounded-full h-9 px-4">
                <LayoutDashboard className="h-4 w-4" />
                {t("nav.dashboard")}
              </Button>
              {me.role === "ADMIN" && (
                <Button onClick={() => navigate("/white-links/admin")} size="sm" variant="outline" className="rounded-full h-9 px-3">
                  <ShieldCheck className="h-4 w-4" />
                  {t("nav.admin")}
                </Button>
              )}
              <Button onClick={logout} size="sm" variant="ghost" className="rounded-full h-9 px-3" aria-label={t("nav.logout")}>
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <div className="hidden sm:flex items-center gap-2">
              <Button onClick={() => navigate("/white-links/login")} size="sm" variant="outline" className="rounded-full h-9 px-4">
                <LogIn className="h-4 w-4" />
                {t("nav.login")}
              </Button>
              <Button onClick={() => navigate("/white-links/register")} size="sm" className="rounded-full h-9 px-4 bg-black hover:bg-black/85">
                {t("nav.register")}
              </Button>
            </div>
          )}

          <button
            className="md:hidden rounded-full border border-black/15 p-2"
            onClick={() => setOpen((v) => !v)}
            aria-label="Menu"
            aria-expanded={open}
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="md:hidden border-t border-black/10 bg-white px-4 py-4 space-y-4">
          <nav className="flex flex-col gap-3">{navItems}</nav>
          <div className="flex flex-col gap-2">
            {me ? (
              <>
                <Button onClick={() => { navigate("/white-links/dashboard"); setOpen(false); }} className="w-full rounded-full">
                  <UserRound className="h-4 w-4" /> {t("nav.dashboard")}
                </Button>
                {me.role === "ADMIN" && (
                  <Button onClick={() => { navigate("/white-links/admin"); setOpen(false); }} variant="outline" className="w-full rounded-full">
                    <ShieldCheck className="h-4 w-4" /> {t("nav.admin")}
                  </Button>
                )}
                <Button onClick={() => { logout(); setOpen(false); }} variant="outline" className="w-full rounded-full">
                  <LogOut className="h-4 w-4" /> {t("nav.logout")}
                </Button>
              </>
            ) : (
              <>
                <Button onClick={() => { navigate("/white-links/register"); setOpen(false); }} className="w-full rounded-full bg-black hover:bg-black/85">
                  {t("nav.register")}
                </Button>
                <Button onClick={() => { navigate("/white-links/login"); setOpen(false); }} variant="outline" className="w-full rounded-full">
                  {t("nav.login")}
                </Button>
              </>
            )}
            <button
              onClick={() => setLang(lang === "fr" ? "ar" : "fr")}
              className="inline-flex items-center justify-center gap-1.5 rounded-full border border-black/15 px-3 py-2 text-xs font-semibold"
            >
              <Globe className="h-3.5 w-3.5" />
              {lang === "fr" ? "العربية" : "Français"}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="mt-auto border-t border-black/10 bg-black text-white">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <Wordmark light />
            <p className="mt-3 max-w-md text-sm leading-relaxed text-white/60">{t("brand.tagline")}</p>
            <p className="text-sm text-white/40">{t("brand.taglineEn")}</p>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <a href="https://whitelineissig.me/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-white/80 hover:text-white transition-colors">
              <ExternalLink className="h-4 w-4" /> whitelineissig.me — {t("brand.club")}
            </a>
            <p className="text-white/40 text-xs leading-relaxed">{t("footer.legal")}</p>
            <p className="text-white/30 text-xs">© {new Date().getFullYear()} {t("footer.rights")}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
