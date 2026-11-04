/**
 * `t()` and locale negotiation (ADR-20261103-i18n-json-messages). Keys are
 * typed from `en.json`, so a typo fails compilation. Values are inserted
 * with `textContent` by the callers, never as HTML.
 */
import type en from "../../locales/en.json";
import { loadIndex, loadMessages, type Messages } from "../app/locales.js";
import { HakenError } from "../domain/errors.js";

export type Key = keyof typeof en;
type PluralBase<K> = K extends `${infer B}.other` ? B : never;
export type PluralKey = PluralBase<Key>;

const PLURAL_CATEGORIES = ["zero", "one", "two", "few", "many", "other"] as const;

let active: Messages = {};
let fallback: Messages = {};
let tag = "en";
let index: Readonly<Record<string, string>> = { en: "English" };

/** Picks the locale: device setting, then `navigator.languages` (exact, then language only), then `en`. */
export function negotiate(
  setting: string | null,
  preferred: readonly string[],
  available: readonly string[],
): string {
  const lower = available.map((a) => a.toLowerCase());
  const pick = (want: string): string | null => {
    const i = lower.indexOf(want.toLowerCase());
    return i === -1 ? null : (available[i] ?? null);
  };
  if (setting !== null) {
    const exact = pick(setting);
    if (exact !== null) return exact;
  }
  for (const p of preferred) {
    const exact = pick(p);
    if (exact !== null) return exact;
  }
  for (const p of preferred) {
    const base = pick(p.split("-")[0] ?? "");
    if (base !== null) return base;
  }
  return "en";
}

export async function initI18n(setting: string | null): Promise<void> {
  index = await loadIndex();
  tag = negotiate(setting, navigator.languages, Object.keys(index));
  fallback = await loadMessages("en");
  active = tag === "en" ? fallback : await loadMessages(tag);
  document.documentElement.lang = tag;
}

export function locale(): string {
  return tag;
}

export function locales(): Readonly<Record<string, string>> {
  return index;
}

export function format(
  template: string,
  params: Readonly<Record<string, string | number>>,
): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new HakenError("ui", "Missing message parameter", { name });
    return typeof value === "number" ? new Intl.NumberFormat(tag).format(value) : value;
  });
}

function lookup(key: string): string {
  const value = active[key] ?? fallback[key];
  if (value === undefined) throw new HakenError("ui", "Missing message key", { key });
  return value;
}

export function t(key: Key, params: Readonly<Record<string, string | number>> = {}): string {
  return format(lookup(key), params);
}

/** Plural message: `<base>.<category>` by `Intl.PluralRules`, falling back to `<base>.other`. */
export function tp(
  base: PluralKey,
  count: number,
  params: Readonly<Record<string, string | number>> = {},
): string {
  const category = new Intl.PluralRules(tag).select(count);
  if (!(PLURAL_CATEGORIES as readonly string[]).includes(category)) {
    throw new HakenError("ui", "Unknown plural category", { category });
  }
  const key = `${base}.${category}`;
  const template =
    active[key] ?? active[`${base}.other`] ?? fallback[key] ?? fallback[`${base}.other`];
  if (template === undefined) throw new HakenError("ui", "Missing plural message", { key });
  return format(template, { count, ...params });
}

export function formatDate(instant: number | Date, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(tag, options).format(instant);
}

export function collator(): Intl.Collator {
  return new Intl.Collator(tag, { sensitivity: "base", numeric: true });
}
