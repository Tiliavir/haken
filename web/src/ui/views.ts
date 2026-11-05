/** Smart lists: views over the user's lists, never stored on the server (chapter 8). */
import type { ListItem, Snapshot, TaskItem } from "../app/service.js";
import { byCodeUnit } from "../domain/compare.js";
import { compareFocus, type FocusPart } from "../domain/focus.js";
import type { Due } from "../domain/vtodo.js";
import type { ListId, SmartId } from "./route.js";

/** Device-local calendar date `YYYY-MM-DD`. */
export function localDate(instant: number): string {
  const d = new Date(instant);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function dueDate(due: Due): string {
  return due.kind === "date" ? due.date : localDate(due.instant);
}

function open(item: TaskItem): boolean {
  return item.view !== null && !item.view.done;
}

/** Due today or overdue, open. */
export function dueNow(item: TaskItem, today: string): boolean {
  const v = item.view;
  return v !== null && !v.done && v.due !== null && dueDate(v.due) <= today;
}

/**
 * *Focus*: first everything due today or overdue (oldest due date first),
 * then the tasks the user put on Focus (most recently added first). The
 * second part does not reset at midnight; a task stays until it is taken
 * off. Completed: tasks completed today that were due or put on Focus.
 */
export interface FocusParts {
  readonly due: TaskItem[];
  readonly picked: TaskItem[];
  readonly completed: TaskItem[];
}

/**
 * *Focus*: first everything due today or overdue, then the tasks the user put
 * on Focus; each part in its own order (manual, else by due date or by the day
 * added). No reset at midnight. Completed: tasks completed today that were due
 * or on Focus.
 */
export function focusParts(snapshot: Snapshot, now: number): FocusParts {
  const today = localDate(now);
  const all = snapshot.lists.filter((l) => !l.errorlogs).flatMap((l) => l.tasks);
  const byPart = (part: FocusPart) => (a: TaskItem, b: TaskItem) =>
    a.view === null || b.view === null ? 0 : compareFocus(part)(a.view, b.view);
  const due = all.filter((t) => dueNow(t, today)).sort(byPart("due"));
  const picked = all
    .filter((t) => t.view !== null && !t.view.done && t.view.focus !== null && !dueNow(t, today))
    .sort(byPart("picked"));
  const completed = all.filter((t) => {
    const v = t.view;
    if (v === null || !v.done || v.completedAt === null || localDate(v.completedAt) !== today)
      return false;
    return v.focus !== null || (v.due !== null && dueDate(v.due) <= today);
  });
  return { due, picked, completed };
}

export function focusTasks(snapshot: Snapshot, now: number): TaskItem[] {
  const p = focusParts(snapshot, now);
  return [...p.due, ...p.picked, ...p.completed];
}

function matches(id: SmartId, item: TaskItem, today: string): boolean {
  const v = item.view;
  if (v === null) return false;
  switch (id) {
    case "focus":
      return dueNow(item, today);
    case "important":
      return !v.done && v.important;
    case "planned":
      return !v.done && v.due !== null;
    case "all":
      return true;
  }
}

export interface ShownList {
  readonly title: string | null;
  readonly smart: SmartId | null;
  readonly list: ListItem | null;
  readonly tasks: readonly TaskItem[];
  readonly openCount: number;
  /** Manual order is only meaningful in a real list. */
  readonly sortable: boolean;
}

export function smartTasks(snapshot: Snapshot, id: SmartId, now: number): TaskItem[] {
  if (id === "focus") return focusTasks(snapshot, now);
  const today = localDate(now);
  const all = snapshot.lists
    .filter((l) => !l.errorlogs)
    .flatMap((l) => l.tasks.filter((t) => matches(id, t, today)));
  if (id === "planned") {
    return all.sort((a, b) => {
      const da = a.view?.due ? dueDate(a.view.due) : "";
      const db = b.view?.due ? dueDate(b.view.due) : "";
      return byCodeUnit(da, db);
    });
  }
  return all;
}

export function smartCount(snapshot: Snapshot, id: SmartId, now: number): number {
  return smartTasks(snapshot, id, now).filter(open).length;
}

export function show(snapshot: Snapshot, id: ListId, now: number): ShownList | null {
  if (id.kind === "smart") {
    const tasks = smartTasks(snapshot, id.id, now);
    return {
      title: null,
      smart: id.id,
      list: null,
      tasks,
      openCount: tasks.filter(open).length,
      sortable: false,
    };
  }
  const list = snapshot.lists.find((l) => l.href === id.href);
  if (list === undefined) return null;
  return {
    title: list.name,
    smart: null,
    list,
    tasks: list.tasks,
    openCount: list.openCount,
    sortable: true,
  };
}

/** Target list for adding from a smart list: the first user list (not errorlogs). */
export function defaultList(snapshot: Snapshot): ListItem | null {
  return snapshot.lists.find((l) => !l.errorlogs) ?? null;
}
