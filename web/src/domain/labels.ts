/** Manual order of the labels in the sidebar (ADR-20261111-label-order). */
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
