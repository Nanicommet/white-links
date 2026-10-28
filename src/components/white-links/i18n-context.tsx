"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { translate, type Lang, type TranslateKey, isRTL } from "@/lib/i18n";

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslateKey) => string;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nContextValue>({
  lang: "fr",
  setLang: () => {},
  t: (k) => translate("fr", k),
  dir: "ltr",
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");

  useEffect(() => {
    // Hydration-safe language restore: SSR renders French, then we sync to
    // the stored preference after mount. setState here is intentional and
    // cannot be derived during render (localStorage is an external store).
    const stored = window.localStorage.getItem("wl_lang");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored === "ar" || stored === "fr") setLangState(stored);
  }, []);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("wl_lang", l);
  }, []);

  const dir = isRTL(lang) ? "rtl" : "ltr";

  useEffect(() => {
    document.documentElement.dir = dir;
    document.documentElement.lang = lang;
  }, [dir, lang]);

  const t = useCallback((key: TranslateKey) => translate(lang, key), [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t, dir }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
