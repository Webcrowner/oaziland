import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { translate, type Language, type Translate } from "./translate";

export { translate };
export type { Language, Translate, TranslateParams } from "./translate";

const STORAGE_KEY = "app_language";
/** French when the phone is set to French, English otherwise. */
export function deviceLanguage(): Language {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith("fr") ? "fr" : "en";
  } catch {
    return "en";
  }
}

interface I18nState {
  language: Language;
  setLanguage: (language: Language) => void;
  t: Translate;
  /** BCP 47 locale for number and date formatting. */
  locale: string;
}

const englishDefault: I18nState = {
  language: "en",
  setLanguage: () => {},
  t: (key, params) => translate("en", key, params),
  locale: "en-US",
};

// Defaults to English so components still render outside the provider (e.g. in tests).
const I18nContext = createContext<I18nState>(englishDefault);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(deviceLanguage);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (saved === "en" || saved === "fr") setLanguageState(saved);
      })
      .catch(() => {});
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  }, []);

  const value = useMemo<I18nState>(
    () => ({
      language,
      setLanguage,
      t: (key, params) => translate(language, key, params),
      locale: language === "fr" ? "fr-FR" : "en-US",
    }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nState {
  return useContext(I18nContext);
}
