"use client";

import React, { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, CircleAlert, PartyPopper, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { api, ApiError, type CurrentStatus, type Me } from "./api";
import { useI18n } from "./i18n-context";
import { Spinner } from "./shared";

type FormData = {
  displayName: string;
  phone: string;
  email: string;
  password: string;
  category: "A" | "B";
  interests: string;
  giftPrefs: string;
  agreeRules: boolean;
  agreeMessages: boolean;
};

const initial: FormData = {
  displayName: "",
  phone: "",
  email: "",
  password: "",
  category: "A",
  interests: "",
  giftPrefs: "",
  agreeRules: false,
  agreeMessages: true,
};

export function Register({ onDone }: { onDone: () => void }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<FormData>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ["public-status"],
    queryFn: () => api<CurrentStatus>("/api/rounds/current"),
    refetchInterval: 30000,
  });
  const round = statusQuery.data?.round ?? null;

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<{ user: Me | null }>("/api/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return { user: null };
        throw e;
      }
    },
    retry: false,
  });

  const registerMutation = useMutation({
    mutationFn: (payload: Partial<FormData>) => api<{ ok: boolean }>("/api/registrations", { method: "POST", body: payload }),
    onSuccess: () => {
      qc.invalidateQueries();
      setStep(3);
    },
    onError: (e) => {
      if (e instanceof ApiError) {
        const fe = (e.payload.fieldErrors ?? {}) as Record<string, string>;
        setFieldErrors(fe);
        const map: Record<string, string> = {
          ALREADY_REGISTERED: t("register.already"),
          REGISTRATION_CLOSED: t("register.closed"),
          NO_OPEN_ROUND: t("register.noRound"),
          DUPLICATE_PHONE: t("register.already"),
          WITHDRAWN_BEFORE_DEADLINE: t("register.already"),
        };
        setGlobalError(map[e.code] ?? `${t("common.error")} (${e.code})`);
      } else {
        setGlobalError(t("common.error"));
      }
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: () => api("/api/registrations/me", { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries();
      setStep(0);
      setGlobalError(null);
    },
  });

  const canContinue = useMemo(() => {
    if (step === 0) {
      return data.displayName.trim().length >= 3 && data.phone.trim().length >= 8 && /\S+@\S+\.\S+/.test(data.email) && data.password.length >= 8 && data.category;
    }
    if (step === 2) return data.agreeRules;
    return true;
  }, [step, data]);

  const myRegQuery = useQuery({
    queryKey: ["my-registration"],
    queryFn: async () => {
      try {
        return await api<{ registration: { status: string; verificationStatus: string } | null }>("/api/registrations/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return { registration: null };
        throw e;
      }
    },
    retry: false,
    refetchInterval: 15000,
  });

  if (statusQuery.isLoading || meQuery.isLoading || myRegQuery.isLoading) return <Spinner />;

  // ── Already registered view ──
  const myReg = myRegQuery.data?.registration;
  const roundOpen = round?.status === "registration_open";
  if (myReg && myReg.status === "ACTIVE" && roundOpen) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16">
          <div className="wl-card p-8 text-center">
            <PartyPopper className="mx-auto h-10 w-10" />
            <h1 className="mt-4 font-display text-4xl">{t("register.already")}</h1>
            <p className="mt-2 text-sm text-black/60">{t("register.successDesc")}</p>
            {myReg.verificationStatus === "PENDING" && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-neutral-100 px-4 py-1.5 text-xs font-semibold">
                <Info className="h-3.5 w-3.5" /> {t("register.pending")}
              </p>
            )}
            <div className="mt-6 flex flex-col sm:flex-row justify-center gap-3">
              <Button onClick={onDone} className="rounded-full bg-black hover:bg-black/85">{t("register.successCta")}</Button>
              <Button
                variant="outline"
                className="rounded-full"
                onClick={() => {
                  if (window.confirm(t("register.withdrawConfirm"))) withdrawMutation.mutate();
                }}
                disabled={withdrawMutation.isPending}
              >
                <Trash2 className="h-4 w-4" /> {t("register.withdraw")}
              </Button>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!roundOpen) {
    return (
      <main className="flex-1">
        <div className="mx-auto max-w-xl px-4 py-16 text-center">
          <div className="wl-card p-10">
            <CircleAlert className="mx-auto h-10 w-10 text-black/40" />
            <h1 className="mt-4 font-display text-4xl">{round ? t("register.closed") : t("register.noRound")}</h1>
            <p className="mt-2 text-sm text-black/60">{t("status.setupDesc")}</p>
            <Button onClick={onDone} variant="outline" className="mt-6 rounded-full">{t("reveal.backHome")}</Button>
          </div>
        </div>
      </main>
    );
  }

  const steps = [t("register.step1"), t("register.step2"), t("register.step3")];
  const err = (f: string) =>
    fieldErrors[f] ? (
      <p className="mt-1.5 text-xs font-medium text-red-600 flex items-center gap-1">
        <CircleAlert className="h-3 w-3" />
        {f === "phone" ? t("register.phoneHint") : f === "password" ? t("register.passwordHint") : t("common.error")}
      </p>
    ) : null;

  return (
    <main className="flex-1">
      <div className="mx-auto max-w-xl px-4 py-12 sm:py-16">
        <div className="text-center">
          <h1 className="font-display text-5xl sm:text-6xl leading-[0.95]">{t("register.title")}</h1>
          <p className="mt-3 text-sm text-black/60">{t("register.subtitle")}</p>
        </div>

        {/* Step indicator */}
        <div className="mt-8 flex items-center justify-center gap-2" aria-hidden="true">
          {steps.map((s, i) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${i === step ? "border-black bg-black text-white" : i < step ? "border-black/40 bg-white" : "border-black/15 text-black/40"}`}>
                {i < step ? <Check className="h-3 w-3" /> : <span>{i + 1}</span>}
                <span className="hidden sm:inline">{s}</span>
              </div>
              {i < steps.length - 1 && <div className="h-px w-4 bg-black/20" />}
            </React.Fragment>
          ))}
        </div>

        <AnimatePresence mode="wait">
          {step === 3 ? (
            /* ── Success ── */
            <motion.div key="success" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="wl-card mt-10 p-8 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-black">
                <Check className="h-7 w-7 text-white" />
              </div>
              <h2 className="mt-5 font-display text-4xl">{t("register.successTitle")}</h2>
              <p className="mt-3 text-sm leading-relaxed text-black/60">{t("register.successDesc")}</p>
              <Button onClick={onDone} className="mt-6 rounded-full bg-black px-8 hover:bg-black/85">{t("register.successCta")}</Button>
            </motion.div>
          ) : (
            <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.25 }} className="wl-card mt-10 p-6 sm:p-8">
              {globalError && (
                <p className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  <CircleAlert className="h-4 w-4 shrink-0" /> {globalError}
                </p>
              )}

              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <Label htmlFor="reg-name">{t("register.name")} *</Label>
                    <Input id="reg-name" className="mt-1.5" placeholder={t("register.namePh")} value={data.displayName} onChange={(e) => setData({ ...data, displayName: e.target.value })} autoComplete="name" />
                    {err("displayName")}
                  </div>
                  <div>
                    <Label htmlFor="reg-phone">{t("register.phone")} *</Label>
                    <div className="mt-1.5 flex">
                      <span className="inline-flex items-center rounded-s-xl border border-e-0 border-input bg-muted px-3 text-sm font-semibold text-black/60" dir="ltr">+216</span>
                      <Input id="reg-phone" className="rounded-s-none" placeholder="24 555 123" inputMode="tel" dir="ltr" value={data.phone} onChange={(e) => setData({ ...data, phone: e.target.value })} />
                    </div>
                    <p className="mt-1.5 text-xs text-black/50">{t("register.phoneHint")}</p>
                    {err("phone")}
                  </div>
                  <div>
                    <Label htmlFor="reg-email">{t("register.email")} *</Label>
                    <Input id="reg-email" className="mt-1.5" type="email" inputMode="email" value={data.email} onChange={(e) => setData({ ...data, email: e.target.value })} autoComplete="email" dir="ltr" />
                    <p className="mt-1.5 text-xs text-black/50">{t("register.emailHint")}</p>
                    {err("email")}
                  </div>
                  <div>
                    <Label htmlFor="reg-password">{t("register.password")} *</Label>
                    <Input id="reg-password" className="mt-1.5" type="password" value={data.password} onChange={(e) => setData({ ...data, password: e.target.value })} autoComplete="new-password" dir="ltr" />
                    <p className="mt-1.5 text-xs text-black/50">{t("register.passwordHint")}</p>
                    {err("password")}
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <Label>{t("register.category")} *</Label>
                    <RadioGroup value={data.category} onValueChange={(v) => setData({ ...data, category: v as "A" | "B" })} className="mt-2 grid grid-cols-2 gap-3">
                      {(["A", "B"] as const).map((c) => (
                        <Label key={c} htmlFor={`cat-${c}`} className={`flex cursor-pointer items-center justify-between rounded-xl border px-4 py-3 text-sm font-semibold transition-colors ${data.category === c ? "border-black bg-black text-white" : "hover:border-black/40"}`}>
                          {c === "A" ? t("register.categoryA") : t("register.categoryB")}
                          <RadioGroupItem value={c} id={`cat-${c}`} className={data.category === c ? "border-white text-white" : ""} />
                        </Label>
                      ))}
                    </RadioGroup>
                    <p className="mt-2 text-xs text-black/50">{t("register.categoryHint")}</p>
                  </div>
                  <div>
                    <Label htmlFor="reg-interests">{t("register.interests")}</Label>
                    <Textarea id="reg-interests" className="mt-1.5 min-h-20" placeholder={t("register.interestsPh")} value={data.interests} onChange={(e) => setData({ ...data, interests: e.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor="reg-gifts">{t("register.gifts")}</Label>
                    <Textarea id="reg-gifts" className="mt-1.5 min-h-20" placeholder={t("register.giftsPh")} value={data.giftPrefs} onChange={(e) => setData({ ...data, giftPrefs: e.target.value })} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="space-y-5">
                  <div className="rounded-2xl border border-black/10 bg-neutral-50 p-4 text-xs leading-relaxed text-black/70">
                    <p className="mb-2 font-bold uppercase tracking-wider text-black/50">{t("common.rules")}</p>
                    <p>{t("rules.r1")}</p>
                    <p className="mt-1">{t("rules.r2")}</p>
                    <p className="mt-1">{t("rules.r3")}</p>
                  </div>
                  <div className="rounded-2xl border border-black/10 bg-neutral-50 p-4 text-xs leading-relaxed text-black/70">
                    <p className="mb-2 font-bold uppercase tracking-wider text-black/50">{t("rules.privacy")}</p>
                    <p>{t("common.privacyText")}</p>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <Checkbox id="agree-rules" checked={data.agreeRules} onCheckedChange={(v) => setData({ ...data, agreeRules: v === true })} />
                      <Label htmlFor="agree-rules" className="text-sm font-normal leading-relaxed">{t("register.agreeRules")} *</Label>
                    </div>
                    <div className="flex items-start gap-3">
                      <Checkbox id="agree-msg" checked={data.agreeMessages} onCheckedChange={(v) => setData({ ...data, agreeMessages: v === true })} />
                      <Label htmlFor="agree-msg" className="text-sm font-normal leading-relaxed">{t("register.agreeMessages")}</Label>
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-8 flex items-center justify-between">
                <Button variant="ghost" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="rounded-full">
                  <ArrowLeft className="h-4 w-4" /> {t("register.back")}
                </Button>
                {step < 2 ? (
                  <Button onClick={() => setStep((s) => s + 1)} disabled={!canContinue} className="rounded-full bg-black px-6 hover:bg-black/85">
                    {t("register.next")} <ArrowRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={() =>
                      registerMutation.mutate({
                        displayName: data.displayName,
                        phone: `+216${data.phone.replace(/\D/g, "")}`.replace("+216+216", "+216"),
                        email: data.email,
                        password: data.password,
                        category: data.category,
                        interests: data.interests || undefined,
                        giftPrefs: data.giftPrefs || undefined,
                        agreeRules: true,
                        agreeMessages: data.agreeMessages,
                      })
                    }
                    disabled={!canContinue || registerMutation.isPending}
                    className="rounded-full bg-black px-6 hover:bg-black/85"
                  >
                    {registerMutation.isPending ? t("common.loading") : t("register.submit")}
                  </Button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
