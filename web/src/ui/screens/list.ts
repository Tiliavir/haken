/** List screen (chapter 8, Screens: List). */
import type { TaskItem } from "../../app/service.js";
import { HakenError } from "../../domain/errors.js";
import { ruleLocked } from "../../domain/vtodo.js";
import type { Ctx } from "../context.js";
import { makeSortable } from "../dnd/sortable.js";
import { afterRemoval, fill, h } from "../dom.js";
import { pasteLines, submitField } from "../fields.js";
import { t, tp } from "../i18n.js";
import { icon } from "../icons.js";
import { type ListId, toHash } from "../route.js";
import { defaultList, focusParts, labelUses, localDate, show, userLists } from "../views.js";
import { backLink } from "./back.js";
import { quickAddDialog } from "./quickadd.js";
import { smartName } from "./sidebar.js";
import { checkCircle, metaLine, starButton } from "./taskparts.js";

function taskRow(
  ctx: Ctx,
  listId: ListId,
  item: TaskItem,
  sortable: boolean,
  showList: boolean,
): HTMLElement {
  const viewLabel = listId.kind === "label" ? listId.name : null;
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
  const locked = ruleLocked(view);
  const listName = showList
    ? (ctx.snapshot.lists.find((l) => l.href === item.list)?.name ?? null)
    : null;
  const movable = sortable && !view.done;
  const title = view.summary === "" ? t("task.untitled") : view.summary;
  return h(
    "li",
    {
      class: view.done ? "task-row done" : "task-row",
      "data-href": item.href,
      "data-sortable": movable ? "" : undefined,
      "data-label": title,
      "aria-current": selected ? "true" : undefined,
    },
    checkCircle(ctx, item, view, locked),
    link(
      [h("span", { class: "title" }, title), metaLine(item, view, ctx.now, listName, viewLabel)],
      movable,
    ),
    starButton(ctx, item, view),
  );
}

/**
 * In *errorlogs*: the tasks and lists sync skips (ADR-20261104-sync-quarantine),
 * each linked to where it can be fixed. Editing a task retries it.
 */
function notSynced(ctx: Ctx): HTMLElement | null {
  const hrefs = ctx.snapshot.quarantined;
  if (hrefs.length === 0) return null;
  const row = (href: string): HTMLElement => {
    const list = ctx.snapshot.lists.find((l) => l.href === href);
    const task = list === undefined ? ctx.app.findItem(href) : null;
    let title: string;
    let target: string | null = null;
    if (list !== undefined) {
      title = list.name;
      target = toHash({ kind: "list", list: { kind: "list", href } });
    } else if (task !== null) {
      const summary = task.view?.summary ?? null;
      if (summary === null) title = t("task.readonly");
      else title = summary === "" ? t("task.untitled") : summary;
      target = toHash({
        kind: "task",
        list: { kind: "list", href: task.list },
        task: href,
      });
    } else {
      // Known only to the server, e.g. a new task that could not be read.
      title = href;
    }
    const text = h("span", { class: "title" }, title);
    return h(
      "li",
      { class: "task-row" },
      h("span", { class: "check-placeholder" }, icon("alert")),
      target === null
        ? h("span", { class: "task-title" }, text)
        : h("a", { class: "task-title", href: target }, text),
    );
  };
  return h(
    "section",
    { class: "not-synced", "aria-labelledby": "not-synced-title" },
    h("h2", { class: "section-title", id: "not-synced-title" }, tp("sync.notSynced", hrefs.length)),
    h("p", { class: "hint" }, t("sync.notSyncedHint")),
    h("ul", { class: "tasks" }, hrefs.map(row)),
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
    // Across lists, a row names its list, unless there is only one.
    const showList =
      shown.smart !== null || (shown.label !== null && userLists(ctx.snapshot).length > 1);
    const open = shown.tasks.filter((x) => !x.view?.done);
    const done = shown.tasks.filter((x) => x.view?.done === true);

    // A view: say where the new task goes (a label view: the label it gets).
    let addLabel = t("list.add");
    if (shown.label !== null) addLabel = t("list.addTo", { list: shown.label });
    else if (shown.smart !== null && target !== null)
      addLabel = t("list.addTo", { list: target.name });
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
        categories: shown.label === null ? [] : [shown.label],
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
      open.map((item) => taskRow(ctx, listId, item, shown.sortable, showList)),
    );
    if (shown.sortable) {
      const label = shown.label;
      const siblings = open.filter((i) => i.view !== null).map((i) => i.href);
      makeSortable(
        openList,
        (href, index) =>
          label === null
            ? ctx.run("ui.move", () => ctx.app.move(href, index))
            : ctx.run("ui.moveAmong", () => ctx.app.moveAmong(href, siblings, index)),
        (href, dropped) => drop(ctx, href, dropped, label),
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
      shown.label === null ? null : labelMenu(ctx, shown.label),
      shown.smart === "focus"
        ? h(
            "div",
            { class: "list-actions" },
            h(
              "button",
              { class: "button", type: "button", onclick: () => quickAddDialog(ctx) },
              t("focus.quickAdd"),
            ),
          )
        : null,
    );

    fill(
      this,
      header,
      shown.list?.errorlogs === true ? notSynced(ctx) : null,
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
              done.map((item) => taskRow(ctx, listId, item, false, showList)),
            ),
          )
        : null,
    );
  }
}

/**
 * A task row dropped on a sidebar target: *Focus*, or a label. From a label
 * view, a label replaces the view's label (a move); elsewhere it is added.
 */
function drop(ctx: Ctx, href: string, target: string, viewLabel: string | null): void {
  if (target === "focus") {
    ctx.run("ui.dropFocus", async () => {
      await ctx.app.edit(href, { kind: "focus", value: localDate(ctx.now) });
      ctx.notify(t("focus.added"));
    });
    return;
  }
  if (!target.startsWith("label:"))
    throw new HakenError("ui", "Unknown drop target", { value: target });
  const label = target.slice("label:".length);
  ctx.run("ui.dropLabel", async () => {
    const view = ctx.snapshot.lists.flatMap((l) => l.tasks).find((i) => i.href === href)?.view;
    if (view == null) throw new HakenError("ui", "Dropped task not found", { path: href });
    // Replace in place (a move) or append; setCategories drops duplicates.
    const value =
      viewLabel === null
        ? [...view.categories, label]
        : view.categories.map((c) => (c === viewLabel ? label : c));
    await ctx.app.edit(href, { kind: "categories", value });
    ctx.notify(
      viewLabel === null ? t("labels.added", { label }) : t("task.moved", { list: label }),
    );
  });
}

/** Texts and actions of an *Edit* menu (list or label). */
interface NameMenu {
  readonly title: string;
  readonly deleteText: string;
  readonly name: string;
  readonly maxLength: number;
  /** Called with a changed, non-empty name. */
  readonly rename: (value: string) => void;
  readonly remove: () => void;
}

/** An *Edit* button opening a dialog: name, *Save*, *Cancel* and a delete button. */
function nameMenu(ctx: Ctx, menu: NameMenu): HTMLElement {
  const dialog = ctx.dialog;
  const edit = (): void => {
    const nameInput = h("input", {
      type: "text",
      name: "name",
      value: menu.name,
      maxlength: String(menu.maxLength),
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
            if (value !== "" && value !== menu.name) menu.rename(value);
          },
        },
        h("h2", {}, menu.title),
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
          { type: "button", class: "button danger", onclick: menu.remove },
          menu.deleteText,
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
      { class: "icon-button", type: "button", "aria-label": menu.title, onclick: edit },
      icon("edit"),
    ),
  );
}

function listMenu(ctx: Ctx, href: string, name: string): HTMLElement {
  return nameMenu(ctx, {
    title: t("list.edit"),
    deleteText: t("list.delete"),
    name,
    maxLength: 200,
    rename: (value) => ctx.run("ui.renameList", () => ctx.app.renameList(href, value)),
    remove: () => remove(ctx, href, name),
  });
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
        // Focus moves to the next list, else the previous one, else the new-list field.
        const row = `list-${toHash({ kind: "list", list: { kind: "list", href } })}`;
        const focus = afterRemoval(row, "@list");
        dialog.close();
        ctx.run("ui.deleteList", async () => {
          await ctx.app.deleteList(href);
          ctx.navigate({ kind: "lists" }, focus);
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

/** *Edit label*: rename or delete it on every task carrying it (ADR-20261108-label-edit). */
function labelMenu(ctx: Ctx, label: string): HTMLElement {
  return nameMenu(ctx, {
    title: t("labels.edit"),
    deleteText: t("labels.delete"),
    name: label,
    maxLength: 100,
    rename: (value) =>
      ctx.run("ui.renameLabel", async () => {
        await ctx.app.renameLabel(label, value);
        ctx.navigate({ kind: "list", list: { kind: "label", name: value } });
      }),
    remove: () => removeLabel(ctx, label),
  });
}

/** Deleting a label removes it from its tasks; the tasks stay, so a plain confirmation is enough. */
function removeLabel(ctx: Ctx, label: string): void {
  const dialog = ctx.dialog;
  fill(
    dialog,
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, t("labels.delete")),
      h(
        "p",
        { class: "warning" },
        tp("labels.deleteConfirm", labelUses(ctx.snapshot, label), { name: label }),
      ),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "button primary" }, t("common.cancel")),
        h(
          "button",
          {
            type: "button",
            class: "button danger",
            onclick: () => {
              dialog.close();
              ctx.run("ui.deleteLabel", async () => {
                await ctx.app.deleteLabel(label);
                ctx.navigate({ kind: "lists" });
              });
            },
          },
          t("common.delete"),
        ),
      ),
    ),
  );
}
