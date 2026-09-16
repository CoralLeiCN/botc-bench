import { englishMessages } from "./messages.ts";
import type { LocalizedText, Marker } from "./types.ts";

export type Language = "zh_hans" | "en";
export const LANGUAGE_STORAGE_KEY = "ravenswood.language";
export const DEFAULT_LANGUAGE: Language = "zh_hans";

export function readLanguage(storage: Pick<Storage, "getItem">): Language {
  try {
    return storage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : DEFAULT_LANGUAGE;
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

export function translate(language: Language, message: string, values: readonly (string | number)[] = []): string {
  const translated = englishMessages[message];
  const template = language === "en" && typeof translated === "string" ? translated : message;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => String(values[Number(index)] ?? placeholder));
}

/** Never invent translations of official text or display both languages together. */
export function localizedText(text: LocalizedText | undefined, language: Language, fallback?: string): string {
  return text?.[language]?.trim() ? text[language]! : fallback ?? translate(language, "所选语言暂无官方文本");
}

/** Keep transient UI messages translatable after they have been raised. */
export interface UiMessage {
  key: string;
  values: readonly (string | number)[];
}
export function uiMessage(key: string, values: readonly (string | number)[] = []): UiMessage {
  return { key, values };
}

const presetLabels: Partial<Record<Marker["type"], string>> = {
  drunk: "醉酒", poisoned: "中毒", protected: "保护", ability_used: "能力已用", red_herring: "红鲱鱼", mad: "疯狂",
};

export function localizedMarker(marker: Marker, language: Language): string {
  const preset = presetLabels[marker.type];
  return preset && (marker.label === preset || marker.label === translate("en", preset))
    ? translate(language, preset) : marker.label;
}
