/** *Quick add* dialog of *Focus* (chapter 8, Screens: List; ADR-20261107-focus-quick-add). */
import type { TaskItem } from "../../app/service.js";
import type { Ctx } from "../context.js";
import { fill, h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import { localDate, type QuickAddGroup, quickAddGroups } from "../views.js";
import { metaLine } from "./taskparts.js";

function groupTitle(g: QuickAddGroup): string {
  if (g.kind === "dueSoon") return t("focus.quickDueSoon");
  if (g.kind === "important") return t("smart.important");
  return g.list ?? "";
}

export function quickAddDialog(ctx: Ctx): void {
  const dialog = ctx.dialog;
  // Added while the dialog is open: the dialog keeps the snapshot it was opened with.
  const added = new Set<string>();
  const filter = h("input", {
    type: "search",
    name: "filter",
    autocomplete: "off",
    enterkeyhint: "search",
  });
  const groups = h("div", { class: "quick-add-groups" });

  const add = (item: TaskItem, index: number): void => {
    ctx.run("ui.quickAdd", async () => {
      // Today at the time of the tap: the dialog may have been opened before midnight.
      await ctx.app.edit(item.href, { kind: "focus", value: localDate(Date.now()) });
      added.add(item.href);
      render();
      // Focus goes to the row that took this one's place, else the previous one, else the filter.
      const buttons = groups.querySelectorAll("button");
      (buttons[Math.min(index, buttons.length - 1)] ?? filter).focus();
    });
  };

  const render = (): void => {
    const shown = quickAddGroups(ctx.snapshot, ctx.now, filter.value)
      .map((g) => ({ ...g, tasks: g.tasks.filter((x) => !added.has(x.href)) }))
      .filter((g) => g.tasks.length > 0);
    let index = 0;
    const row = (item: TaskItem): HTMLElement | null => {
      const view = item.view;
      if (view === null) return null;
      const i = index++;
      const title = view.summary === "" ? t("task.untitled") : view.summary;
      return h(
        "li",
        { class: "quick-add-row" },
        h(
          "span",
          { class: "task-title" },
          h("span", { class: "title" }, title),
          metaLine(item, view, ctx.now, null),
        ),
        h(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": t("focus.quickAddTask", { task: title }),
            onclick: () => add(item, i),
          },
          icon("plus"),
        ),
      );
    };
    fill(
      groups,
      shown.length === 0
        ? h("p", { class: "empty" }, t("focus.quickEmpty"))
        : shown.map((g) =>
            h(
              "section",
              {},
              h("h3", { class: "part-title" }, groupTitle(g)),
              h("ul", { class: "tasks", "aria-label": groupTitle(g) }, g.tasks.map(row)),
            ),
          ),
    );
  };

  filter.addEventListener("input", render);
  // Enter in the filter must not submit (close) the dialog.
  filter.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });
  render();
  fill(
    dialog,
    h(
      "form",
      { method: "dialog", class: "quick-add" },
      h("h2", {}, t("focus.quickAdd")),
      h("label", {}, t("focus.quickFilter"), filter),
      groups,
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "button primary" }, t("common.close")),
      ),
    ),
  );
  dialog.showModal();
  filter.focus();
}
