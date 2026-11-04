/**
 * Manual order (`X-APPLE-SORT-ORDER`, ascending). Only the moved task is
 * written; other tasks keep their values, so clients never fight over order.
 */
import { HakenError } from "./errors.js";
import type { TaskView } from "./vtodo.js";

export function compareTasks(a: TaskView, b: TaskView): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}

/** Order for a new task placed before all others (new tasks go on top). */
export function orderOnTop(siblings: readonly TaskView[], fallback: number): number {
  if (siblings.length === 0) return fallback;
  return Math.min(...siblings.map((t) => t.sortOrder)) - 1;
}

/** Order for a new item appended after all others (steps). */
export function orderAtEnd(siblings: readonly TaskView[], fallback: number): number {
  if (siblings.length === 0) return fallback;
  return Math.max(...siblings.map((t) => t.sortOrder)) + 1;
}

export interface Reorder {
  readonly uid: string;
  readonly sortOrder: number;
}

/**
 * New orders after moving `moved` to position `targetIndex` of `sorted`
 * (sorted by `compareTasks`, containing `moved`). Usually one entry; when
 * the neighbours leave no integer gap, the following tasks are shifted by
 * the smallest amount that makes room.
 */
export function reorder(sorted: readonly TaskView[], movedUid: string, targetIndex: number): Reorder[] {
  const rest = sorted.filter((t) => t.uid !== movedUid);
  if (rest.length === sorted.length) {
    throw new HakenError("domain", "Moved task is not in the list", { uid: movedUid });
  }
  const index = Math.max(0, Math.min(targetIndex, rest.length));
  const prev = rest[index - 1];
  const next = rest[index];
  if (prev === undefined && next === undefined) return [];
  if (prev === undefined && next !== undefined) return [{ uid: movedUid, sortOrder: next.sortOrder - 1 }];
  if (next === undefined && prev !== undefined) return [{ uid: movedUid, sortOrder: prev.sortOrder + 1 }];
  if (prev === undefined || next === undefined) return [];
  if (next.sortOrder - prev.sortOrder >= 2) {
    return [{ uid: movedUid, sortOrder: Math.floor((prev.sortOrder + next.sortOrder) / 2) }];
  }
  // No gap: place after prev and shift the following tasks up so the order stays strict.
  const out: Reorder[] = [{ uid: movedUid, sortOrder: prev.sortOrder + 1 }];
  let floor = prev.sortOrder + 1;
  for (const task of rest.slice(index)) {
    if (task.sortOrder > floor) break;
    floor += 1;
    out.push({ uid: task.uid, sortOrder: floor });
  }
  return out;
}
