/** Smart lists: views over the user's lists, never stored on the server (chapter 8). */
import type { ListItem, Snapshot, TaskItem } from "../app/service.js";
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
 * *Today*: first everything due today or overdue (oldest due date first),
 * then the tasks the user put on Today (most recently added first). The
 * second part does not reset at midnight; a task stays until it is taken
 * off. Completed: tasks completed today that were due or put on Today.
 */
export function todayTasks(snapshot: Snapshot, now: number): TaskItem[] {
  const today = localDate(now);
  const all = snapshot.lists.filter((l) => !l.errorlogs).flatMap((l) => l.tasks);
  const due = all
    .filter((t) => dueNow(t, today))
    .sort((a, b) => {
      const da = a.view?.due ? dueDate(a.view.due) : "";
      const db = b.view?.due ? dueDate(b.view.due) : "";
      return da < db ? -1 : da > db ? 1 : 0;
    });
  const pinned = all
    .filter((t) => t.view !== null && !t.view.done && t.view.today !== null && !dueNow(t, today))
    .sort((a, b) =>
      (a.view?.today ?? "") < (b.view?.today ?? "")
        ? 1
        : (a.view?.today ?? "") > (b.view?.today ?? "")
          ? -1
          : 0,
    );
  const completed = all.filter((t) => {
    const v = t.view;
    if (v === null || !v.done || v.completedAt === null || localDate(v.completedAt) !== today)
      return false;
    return v.today !== null || (v.due !== null && dueDate(v.due) <= today);
  });
  return [...due, ...pinned, ...completed];
}

function matches(id: SmartId, item: TaskItem, today: string): boolean {
  const v = item.view;
  if (v === null) return false;
  switch (id) {
    case "today":
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
  if (id === "today") return todayTasks(snapshot, now);
  const today = localDate(now);
  const all = snapshot.lists
    .filter((l) => !l.errorlogs)
    .flatMap((l) => l.tasks.filter((t) => matches(id, t, today)));
  if (id === "planned") {
    return all.sort((a, b) => {
      const da = a.view?.due ? dueDate(a.view.due) : "";
      const db = b.view?.due ? dueDate(b.view.due) : "";
      return da < db ? -1 : da > db ? 1 : 0;
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
