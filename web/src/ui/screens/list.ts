/** List screen (chapter 8, Screens: List). */
import type { TaskItem } from "../../app/service.js";
import { HakenError } from "../../domain/errors.js";
import type { Ctx } from "../context.js";
import { makeSortable } from "../dnd/sortable.js";
import { fill, h } from "../dom.js";
import { pasteLines, submitField } from "../fields.js";
import { t, tp } from "../i18n.js";
import { icon } from "../icons.js";
import { type ListId, toHash } from "../route.js";
import { defaultList, focusParts, localDate, show } from "../views.js";
import { backLink } from "./back.js";
import { smartName } from "./sidebar.js";
import { checkCircle, metaLine, starButton } from "./taskparts.js";

function taskRow(
  ctx: Ctx,
  listId: ListId,
  item: TaskItem,
  sortable: boolean,
  showList: boolean,
): HTMLElement {
  const selected = ctx.route.kind === "task" && ctx.route.task === item.href;
  const link = (children: (Node | string | null)[], movable = false) =>
    h(
      "a",
      {
        class: "task-title",
        href: toHash({ kind: "task", list: listId, task: item.href }),
        // Keyboard reordering (Alt+↑/↓) keeps focus across the re-render.
        "data-focus": `task-${item.href}`,
        "aria-keyshortcuts": movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
      },
      ...children,
    );
  if (item.view === null) {
    return h(
      "li",
      { class: "task-row invalid", "aria-current": selected ? "true" : undefined },
      h("span", { class: "check-placeholder" }, icon("alert")),
      link([h("span", { class: "title" }, t("task.readonly"))]),
    );
  }
  const view = item.view;
  const readonly = view.repeats && view.recurrence === null;
  const listName = showList
    ? (ctx.snapshot.lists.find((l) => l.href === item.list)?.name ?? null)
    : null;
  const movable = sortable && !view.done && !readonly;
  return h(
    "li",
    {
      class: view.done ? "task-row done" : "task-row",
      "data-href": item.href,
      "data-sortable": movable ? "" : undefined,
      "aria-current": selected ? "true" : undefined,
    },
    checkCircle(ctx, item, view, readonly),
    link(
      [
        h("span", { class: "title" }, view.summary === "" ? t("task.untitled") : view.summary),
        metaLine(item, view, ctx.now, listName),
      ],
      movable,
    ),
    starButton(ctx, item, view, readonly),
  );
}

export class HakenList extends HTMLElement {
  render(ctx: Ctx, listId: ListId): void {
    const shown = show(ctx.snapshot, listId, ctx.now);
    if (shown === null) {
      fill(this, h("p", { class: "empty" }, t("list.missing")));
      return;
    }
    const title = shown.smart !== null ? smartName(shown.smart) : (shown.title ?? "");
    const target = shown.list ?? defaultList(ctx.snapshot);
    const open = shown.tasks.filter((x) => !x.view?.done);
    const done = shown.tasks.filter((x) => x.view?.done === true);

    // A smart list is a view: say which list the new task goes to.
    const addLabel =
      shown.smart !== null && target !== null
        ? t("list.addTo", { list: target.name })
        : t("list.add");
    const input = h("input", {
      class: "add-input",
      type: "text",
      name: "task",
      placeholder: addLabel,
      "aria-label": addLabel,
      maxlength: "1000",
      autocomplete: "off",
      enterkeyhint: "done",
    });
    const addTasks = (values: string[]): Promise<unknown> => {
      if (target === null) throw new HakenError("ui", "No list to add tasks to");
      // Today at submit time: the screen may have been rendered before midnight.
      const date = localDate(Date.now());
      return ctx.app.addTasks(target.href, values, {
        important: shown.smart === "important",
        due: shown.smart === "planned" ? { kind: "date", date } : null,
        focus: shown.smart === "focus" ? date : null,
      });
    };
    if (target !== null) pasteLines(input, addTasks, (work) => ctx.run("ui.addTasks", work));
    const add = h(
      "form",
      {
        class: "add-task",
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (target === null) return;
          ctx.run("ui.addTask", () => submitField(input, (value) => addTasks([value])));
        },
      },
      h("button", { class: "icon-button", type: "submit", "aria-label": addLabel }, icon("plus")),
      input,
    );

    // Focus: two parts, each with its own manual order.
    const parts =
      shown.smart === "focus"
        ? (() => {
            const p = focusParts(ctx.snapshot, ctx.now);
            const part = (
              name: "due" | "picked",
              items: TaskItem[],
              label: string,
            ): HTMLElement | null => {
              if (items.length === 0) return null;
              const ul = h(
                "ul",
                { class: "tasks", "aria-label": label },
                items.map((item) => taskRow(ctx, listId, item, true, true)),
              );
              const hrefs = items.filter((i) => i.view !== null).map((i) => i.href);
              makeSortable(ul, (href, index) =>
                ctx.run("ui.moveFocus", () => ctx.app.moveInFocus(href, name, hrefs, index)),
              );
              return h(
                "section",
                { class: "focus-part" },
                h("h2", { class: "part-title" }, label),
                ul,
              );
            };
            return [
              part("due", p.due, t("focus.partDue")),
              part("picked", p.picked, t("focus.partPicked")),
            ];
          })()
        : null;

    const openList = h(
      "ul",
      { class: "tasks", "aria-label": title },
      open.map((item) => taskRow(ctx, listId, item, shown.sortable, shown.smart !== null)),
    );
    if (shown.sortable) {
      makeSortable(
        openList,
        (href, index) => ctx.run("ui.move", () => ctx.app.move(href, index)),
        (href, target) => {
          if (target !== "focus") return;
          ctx.run("ui.dropFocus", async () => {
            await ctx.app.edit(href, { kind: "focus", value: localDate(ctx.now) });
            ctx.notify(t("focus.added"));
          });
        },
      );
    }

    const back = backLink("#/", t("lists.title"));

    const header = h(
      "header",
      { class: "list-header" },
      back,
      h("h1", { class: "page-title" }, title),
      h("p", { class: "subtitle" }, tp("list.open", shown.openCount)),
      shown.list !== null && !shown.list.errorlogs
        ? listMenu(ctx, shown.list.href, shown.list.name)
        : null,
    );

    fill(
      this,
      header,
      target === null ? null : add,
      open.length === 0 && done.length === 0 ? h("p", { class: "empty" }, t("list.empty")) : null,
      parts ?? openList,
      done.length > 0
        ? h(
            "details",
            { class: "completed" },
            h("summary", {}, tp("list.completed", done.length)),
            h(
              "ul",
              { class: "tasks" },
              done.map((item) => taskRow(ctx, listId, item, false, shown.smart !== null)),
            ),
          )
        : null,
    );
  }
}

function listMenu(ctx: Ctx, href: string, name: string): HTMLElement {
  const dialog = ctx.dialog;
  const edit = (): void => {
    const nameInput = h("input", {
      type: "text",
      name: "name",
      value: name,
      maxlength: "200",
      required: true,
      autocomplete: "off",
    });
    fill(
      dialog,
      h(
        "form",
        {
          method: "dialog",
          onsubmit: () => {
            const value = nameInput.value.trim();
            if (value !== "" && value !== name)
              ctx.run("ui.renameList", () => ctx.app.renameList(href, value));
          },
        },
        h("h2", {}, t("list.edit")),
        h("label", {}, t("list.name"), nameInput),
        h(
          "div",
          { class: "actions" },
          h(
            "button",
            { type: "button", class: "button", onclick: () => dialog.close() },
            t("common.cancel"),
          ),
          h("button", { type: "submit", class: "button primary" }, t("common.save")),
        ),
        h(
          "button",
          { type: "button", class: "button danger", onclick: () => remove(ctx, href, name) },
          t("list.delete"),
        ),
      ),
    );
    dialog.showModal();
  };
  return h(
    "div",
    { class: "list-actions" },
    h(
      "button",
      { class: "icon-button", type: "button", "aria-label": t("list.edit"), onclick: edit },
      icon("edit"),
    ),
  );
}

/** Deleting a list needs its name typed in; only then is the delete button enabled. */
function remove(ctx: Ctx, href: string, name: string): void {
  const dialog = ctx.dialog;
  const count = ctx.snapshot.lists.find((l) => l.href === href)?.tasks.length ?? 0;
  const confirmInput = h("input", { type: "text", name: "confirm", autocomplete: "off" });
  const confirm = h(
    "button",
    {
      type: "button",
      class: "button danger",
      disabled: true,
      onclick: () => {
        dialog.close();
        ctx.run("ui.deleteList", async () => {
          await ctx.app.deleteList(href);
          ctx.navigate({ kind: "lists" });
        });
      },
    },
    t("common.delete"),
  );
  confirmInput.addEventListener("input", () => {
    confirm.disabled = confirmInput.value.trim() !== name;
  });
  fill(
    dialog,
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, t("list.delete")),
      h("p", { class: "warning" }, tp("list.deleteConfirm", count, { name })),
      h("label", {}, t("list.deletePrompt", { name }), confirmInput),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "button primary" }, t("common.cancel")),
        confirm,
      ),
    ),
  );
  confirmInput.focus();
}
