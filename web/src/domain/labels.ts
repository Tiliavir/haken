/** Labels: manual order (ADR-20261111-label-order) and emoji (ADR-20261113-label-emoji), on this device. */
import { byCodeUnit } from "./compare.js";
import { InvalidInputError } from "./errors.js";

/** Labels in `order` first, in that order; the others after them, by name. */
export function sortLabels(
  names: Iterable<string>,
  order: readonly string[],
  collator: Intl.Collator,
): string[] {
  const rank = new Map(order.map((name, i) => [name, i]));
  return [...names].sort((a, b) => {
    const ra = rank.get(a) ?? order.length;
    const rb = rank.get(b) ?? order.length;
    return ra - rb || collator.compare(a, b) || byCodeUnit(a, b);
  });
}

/** Moves `label` to `index` of `shown` (the labels as the sidebar shows them). */
export function moveLabel(shown: readonly string[], label: string, index: number): string[] {
  const rest = shown.filter((name) => name !== label);
  if (rest.length === shown.length) {
    throw new InvalidInputError("domain", "Moved label is not shown", { label });
  }
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, label);
  return rest;
}

/** `order` after a rename or delete applied by `next`; a merged label keeps its first place. */
export function relabelOrder(
  order: readonly string[],
  next: (names: readonly string[]) => string[],
): string[] {
  return [...new Set(next(order))];
}

/** Validates a stored or requested order: distinct, non-empty names. */
export function asLabelOrder(value: unknown): string[] {
  const valid =
    Array.isArray(value) &&
    value.every((v) => typeof v === "string" && v !== "") &&
    new Set(value).size === value.length;
  if (!valid) throw new InvalidInputError("domain", "Invalid label order");
  return [...(value as string[])];
}

// ------------------------------------------------- emoji (ADR-20261113-label-emoji)

const PICTOGRAPHIC = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

/** Whether `value` is exactly one emoji (one grapheme with a pictographic or flag character). */
export function isEmoji(value: string): boolean {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)];
  return graphemes.length === 1 && PICTOGRAPHIC.test(value);
}

/** Validates a stored map label → emoji (a JSON object): non-empty names, one emoji each. */
export function asLabelEmoji(value: unknown): Map<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new InvalidInputError("domain", "Invalid label emoji");
  const entries = Object.entries(value);
  if (!entries.every(([name, emoji]) => name !== "" && typeof emoji === "string" && isEmoji(emoji)))
    throw new InvalidInputError("domain", "Invalid label emoji");
  return new Map(entries as [string, string][]);
}

/** `emoji` with `label` set to `value` (`""` removes it). */
export function withLabelEmoji(
  emoji: ReadonlyMap<string, string>,
  label: string,
  value: string,
): Map<string, string> {
  if (label === "") throw new InvalidInputError("domain", "Empty label name");
  if (value !== "" && !isEmoji(value))
    throw new InvalidInputError("domain", "Not one emoji", { value });
  const next = new Map(emoji);
  if (value === "") next.delete(label);
  else next.set(label, value);
  return next;
}

/** `emoji` after a rename or delete applied by `next`; a label renamed onto another keeps the other's emoji. */
export function relabelEmoji(
  emoji: ReadonlyMap<string, string>,
  next: (names: readonly string[]) => string[],
): Map<string, string> {
  const out = new Map<string, string>();
  const moved: [string, string][] = [];
  for (const [name, value] of emoji) {
    const to = next([name])[0];
    if (to === undefined) continue;
    if (to === name) out.set(name, value);
    else moved.push([to, value]);
  }
  for (const [to, value] of moved) if (!out.has(to)) out.set(to, value);
  return out;
}

export function labelEmojiJson(emoji: ReadonlyMap<string, string>): string {
  return JSON.stringify(Object.fromEntries(emoji));
}
