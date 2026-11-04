/** Pieces shared by the list and task screens. */
import type { TaskItem } from "../../app/service.js";
import type { TaskView } from "../../domain/vtodo.js";
import type { Ctx } from "../context.js";
import { h } from "../dom.js";
import { formatDate, t } from "../i18n.js";
import { icon } from "../icons.js";
import { dueDate, localDate } from "../views.js";
import { describe } from "./repeat.js";

export function checkCircle(
  ctx: Ctx,
  item: TaskItem,
  view: TaskView,
  readonly: boolean,
): HTMLElement {
  return h(
    "button",
    {
      class: view.done ? "check done" : "check",
      type: "button",
      "aria-label": view.done ? t("task.uncomplete") : t("task.complete"),
      "aria-pressed": view.done ? "true" : "false",
      disabled: readonly,
      onclick: () =>
        ctx.run("ui.toggleDone", () =>
          ctx.app.edit(item.href, { kind: "done", value: !view.done }),
        ),
    },
    icon("check", "icon check-mark"),
  );
}

export function starButton(
  ctx: Ctx,
  item: TaskItem,
  view: TaskView,
  readonly: boolean,
): HTMLElement {
  return h(
    "button",
    {
      class: view.important ? "star on" : "star",
      type: "button",
      "aria-label": view.important ? t("task.unstar") : t("task.star"),
      "aria-pressed": view.important ? "true" : "false",
      disabled: readonly,
      onclick: () =>
        ctx.run("ui.toggleImportant", () =>
          ctx.app.edit(item.href, { kind: "important", value: !view.important }),
        ),
    },
    icon("star"),
  );
}

export function dueLabel(view: TaskView, now: number): string | null {
  if (view.due === null) return null;
  const day = dueDate(view.due);
  const today = localDate(now);
  const tomorrow = localDate(now + 86_400_000);
  if (day === today) return t("due.today");
  if (day === tomorrow) return t("due.tomorrow");
  const date =
    view.due.kind === "date"
      ? formatDate(new Date(`${view.due.date}T12:00:00`), {
          weekday: "short",
          day: "numeric",
          month: "short",
        })
      : formatDate(view.due.instant, {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
  return t("task.due", { date });
}

export function isOverdue(view: TaskView, now: number): boolean {
  return view.due !== null && !view.done && dueDate(view.due) < localDate(now);
}

export function metaLine(
  item: TaskItem,
  view: TaskView,
  now: number,
  listName: string | null,
): HTMLElement | null {
  const parts: HTMLElement[] = [];
  if (listName !== null) parts.push(h("span", { class: "meta-item" }, listName));
  if (item.steps.length > 0) {
    const done = item.steps.filter((s) => s.view?.done === true).length;
    parts.push(
      h("span", { class: "meta-item" }, t("task.steps", { done, total: item.steps.length })),
    );
  }
  const due = dueLabel(view, now);
  if (due !== null) {
    parts.push(
      h(
        "span",
        { class: isOverdue(view, now) ? "meta-item overdue" : "meta-item" },
        icon("calendar", "icon small"),
        due,
      ),
    );
  }
  if (view.repeats) {
    parts.push(
      h(
        "span",
        { class: "meta-item" },
        icon("repeat", "icon small"),
        view.recurrence === null ? t("repeat.custom") : describe(view.recurrence),
      ),
    );
  }
  if (view.attachments.length > 0) {
    parts.push(
      h(
        "span",
        { class: "meta-item", "aria-label": t("task.attachments") },
        icon("paperclip", "icon small"),
      ),
    );
  }
  if (item.conflicts.length > 0) {
    parts.push(
      h(
        "span",
        { class: "meta-item conflict-marker" },
        icon("merge", "icon small"),
        t("conflict.marker"),
      ),
    );
  }
  for (const label of view.categories) parts.push(h("span", { class: "chip" }, label));
  return parts.length === 0 ? null : h("span", { class: "meta" }, parts);
}

export function formatSize(bytes: number, locale: string): string {
  const nf = (n: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(n);
  if (bytes < 1024) return `${nf(bytes, 0)} B`;
  if (bytes < 1024 * 1024) return `${nf(bytes / 1024, 0)} KB`;
  return `${nf(bytes / (1024 * 1024), 1)} MB`;
}
