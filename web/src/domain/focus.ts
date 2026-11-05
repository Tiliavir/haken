/**
 * Order inside *Focus* ([Focus ADR](../../../docs/arc42/adr/ADR-20261104-focus.md)).
 * Each part has its own default; a task moved by hand carries
 * `X-HAKEN-FOCUS-ORDER`, computed between its new neighbours' effective
 * values, so manual and default orders mix on one scale.
 */
import { APPLE_EPOCH_SECONDS, type Due, type TaskView } from "./vtodo.js";

export type FocusPart = "due" | "picked";

function daySeconds(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Math.floor(new Date(y, m - 1, d).getTime() / 1000) - APPLE_EPOCH_SECONDS;
}

function dueSeconds(due: Due): number {
  return due.kind === "date"
    ? daySeconds(due.date)
    : Math.floor(due.instant / 1000) - APPLE_EPOCH_SECONDS;
}

/**
 * Effective order. Due part: oldest due date first. Picked part: most
 * recently added first (the day added, negated).
 */
export function focusRank(view: TaskView, part: FocusPart): number {
  if (view.focusOrder !== null) return view.focusOrder;
  if (part === "due") return view.due === null ? 0 : dueSeconds(view.due);
  return view.focus === null ? 0 : -daySeconds(view.focus);
}

export function compareFocus(part: FocusPart): (a: TaskView, b: TaskView) => number {
  return (a, b) => {
    const d = focusRank(a, part) - focusRank(b, part);
    if (d !== 0) return d;
    return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
  };
}

/** The part's views with `sortOrder` replaced by the effective focus order, for `reorder()`. */
export function asFocusOrder(views: readonly TaskView[], part: FocusPart): TaskView[] {
  return views.map((v) => ({ ...v, sortOrder: focusRank(v, part) })).sort(compareFocus(part));
}
