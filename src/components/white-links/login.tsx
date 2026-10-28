"use client";

import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LogIn, MailQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "./api";
import { useI18n } from "./i18n-context";

export function Login({ onSuccess, onRegister }: { onSuccess: () => void; onRegister: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [forgotSent, setForgotSent] = useState(false);

  const loginMutation = useMutation({
    mutationFn: () => api<{ ok: boolean }>("/api/auth/login", { method: "POST", body: { email, password } }),
    onSuccess: () => {
      qc.invalidateQueries();
      onSuccess();
    },
    onError: (e) => {
      const map: Record<string, string> = {
        INVALID_CREDENTIALS: "E-mail ou mot de passe incorrect.",
        RATE_LIMITED: "Trop de tentatives. Réessaie dans 15 minutes.",
      };
      setError(e instanceof ApiError ? map[e.code] ?? `${t("common.error")} (${e.code})` : t("common.error"));
    },
  });

  const forgotMutation = useMutation({
    mutationFn: () => api("/api/auth/forgot", { method: "POST", body: { email } }),
    onSuccess: () => setForgotSent(true),
  });

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-md px-4 py-16 sm:py-24">
        <div className="wl-card p-8">
          {mode === "login" ? (
            <>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-black">
                  <LogIn className="h-5 w-5 text-white" />
                </div>
                <h1 className="mt-4 font-display text-4xl">{t("login.title")}</h1>
              </div>
              {error && (
                <p className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  <CircleAlert className="h-4 w-4 shrink-0" /> {error}
                </p>
              )}
              <form
                className="mt-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  setError(null);
                  loginMutation.mutate();
                }}
              >
                <div>
                  <Label htmlFor="login-email">{t("login.email")}</Label>
                  <Input id="login-email" className="mt-1.5" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
                </div>
                <div>
                  <Label htmlFor="login-password">{t("login.password")}</Label>
                  <Input id="login-password" className="mt-1.5" type="password" dir="ltr" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
                </div>
                <Button type="submit" disabled={loginMutation.isPending} className="w-full rounded-full bg-black hover:bg-black/85">
                  {loginMutation.isPending ? t("common.loading") : t("login.submit")}
                </Button>
              </form>
              <div className="mt-5 flex flex-col gap-2 text-center text-sm">
                <button onClick={() => { setMode("forgot"); setError(null); }} className="text-black/50 underline-offset-4 hover:text-black hover:underline">
                  {t("login.forgot")}
                </button>
                <button onClick={onRegister} className="font-semibold underline-offset-4 hover:underline">
                  {t("login.noAccount")}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-black">
                  <MailQuestion className="h-5 w-5 text-white" />
                </div>
                <h1 className="mt-4 font-display text-4xl">{t("login.forgotTitle")}</h1>
                <p className="mt-2 text-sm text-black/60">{t("login.forgotDesc")}</p>
              </div>
              {forgotSent ? (
                <p className="mt-6 rounded-xl border border-black/10 bg-neutral-50 px-4 py-3 text-center text-sm font-medium">
                  ✅ {t("login.forgotSent")}
                </p>
              ) : (
                <form
                  className="mt-6 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    forgotMutation.mutate();
                  }}
                >
                  <div>
                    <Label htmlFor="forgot-email">{t("login.email")}</Label>
                    <Input id="forgot-email" className="mt-1.5" type="email" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={forgotMutation.isPending} className="w-full rounded-full bg-black hover:bg-black/85">
                    {forgotMutation.isPending ? t("common.loading") : t("common.confirm")}
                  </Button>
                </form>
              )}
              <button onClick={() => setMode("login")} className="mt-5 w-full text-center text-sm text-black/50 hover:text-black underline-offset-4 hover:underline">
                ← {t("login.title")}
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
