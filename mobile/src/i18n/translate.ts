import { en, fr, type MessageKey } from "./messages";

export type Language = "en" | "fr";
export type TranslateParams = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: TranslateParams) => string;

const DICTIONARIES: Record<Language, Record<MessageKey, string>> = { en, fr };

/** Looks a key up in the chosen language (falling back to English) and fills in `{placeholders}`. */
export function translate(language: Language, key: MessageKey, params?: TranslateParams): string {
  const template = DICTIONARIES[language][key] ?? en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

/** English translator: the default for helpers that are also called without a language (and from tests). */
export const translateEnglish: Translate = (key, params) => translate("en", key, params);
