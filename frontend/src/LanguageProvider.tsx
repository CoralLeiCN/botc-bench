import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, localizedText, readLanguage, translate, type Language } from "./language";
import type { LocalizedText } from "./types";

function languageTools(language: Language) {
  return {
    language,
    locale: language === "en" ? "en-GB" : "zh-CN",
    t: (message: string, values?: readonly (string | number)[]) => translate(language, message, values),
    localize: (text: LocalizedText | undefined, fallback?: string) => localizedText(text, language, fallback),
  };
}

const LanguageContext = createContext({ ...languageTools(DEFAULT_LANGUAGE), setLanguage: (_language: Language) => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return readLanguage(window.localStorage); } catch { return DEFAULT_LANGUAGE; }
  });
  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-Hans";
    try { window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language); } catch { /* The switch still works without storage. */ }
  }, [language]);
  const value = useMemo(() => ({ ...languageTools(language), setLanguage }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() { return useContext(LanguageContext); }

export function LanguageSwitch() {
  const { language, setLanguage, t } = useLanguage();
  return (
    <div className="language-switch" role="group" aria-label={t("语言")}>
      <button type="button" lang="zh-Hans" aria-pressed={language === "zh_hans"} onClick={() => setLanguage("zh_hans")}>中文</button>
      <button type="button" lang="en" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>English</button>
    </div>
  );
}
