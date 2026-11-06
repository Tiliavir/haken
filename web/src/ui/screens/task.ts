/** Task detail (chapter 8, Screens: Task; States: conflict notes). */
import { ATTACHMENT_LIMIT, type TaskItem } from "../../app/service.js";
import { HakenError } from "../../domain/errors.js";
import type { Attachment, TaskView } from "../../domain/vtodo.js";
import type { Ctx } from "../context.js";
import { fill, h } from "../dom.js";
import { autosave, submitField } from "../fields.js";
import { formatDate, locale, t } from "../i18n.js";
import { icon } from "../icons.js";
import { type ListId, toHash } from "../route.js";
import { dueDate, localDate } from "../views.js";
import { repeatRow } from "./repeat.js";
import { checkCircle, formatSize, starButton } from "./taskparts.js";

/** Human-readable value of a conflict note's lines. */
function conflictValue(lines: string): string {
  if (lines === "") return t("conflict.absent");
  const unfolded = lines.replace(/\r\n[ \t]/g, "");
  const values = unfolded.split("\r\n").map((line) => {
    const colon = line.indexOf(":");
    return colon === -1
      ? line
      : line
          .slice(colon + 1)
          .replace(/\\n/gi, "\n")
          .replace(/\\([,;\\])/g, "$1");
  });
  return values.join(" · ");
}

function groupName(group: string): string {
  switch (group) {
    case "SUMMARY":
      return t("conflict.group.summary");
    case "DESCRIPTION":
      return t("conflict.group.description");
    case "COMPLETION":
      return t("conflict.group.completion");
    case "PRIORITY":
      return t("conflict.group.priority");
    case "DUE":
      return t("conflict.group.due");
    case "CATEGORIES":
      return t("conflict.group.categories");
    case "ATTACH":
      return t("conflict.group.attachments");
    case "X-APPLE-SORT-ORDER":
      return t("conflict.group.order");
    case "RRULE":
      return t("conflict.group.repeat");
    case "DTSTART":
      return t("conflict.group.start");
    case "*":
      return t("conflict.group.whole");
    default:
      return group;
  }
}

function conflicts(ctx: Ctx, item: TaskItem): HTMLElement | null {
  if (item.conflicts.length === 0) return null;
  return h(
    "section",
    { class: "group conflicts", "aria-label": t("conflict.title") },
    item.conflicts.map((c) =>
      h(
        "div",
        { class: "conflict" },
        h("p", { class: "conflict-head" }, icon("merge", "icon small"), groupName(c.group)),
        c.group === "*"
          ? h("p", { class: "conflict-why" }, t("conflict.wholeText"))
          : [
              h(
                "p",
                { class: "conflict-why" },
                c.lost === "local" ? t("conflict.local") : t("conflict.server"),
              ),
              h("p", { class: "conflict-value" }, conflictValue(c.lines)),
            ],
        h(
          "div",
          { class: "actions" },
          c.group === "*"
            ? h(
                "button",
                {
                  type: "button",
                  class: "button",
                  onclick: () =>
                    ctx.run("ui.exportConflict", async () => {
                      // The note holds a whole resource: the local version that lost.
                      if (!c.lines.startsWith("BEGIN:VCALENDAR\r\n"))
                        throw new HakenError("ui", "Whole-resource note is not a calendar", {
                          id: c.id,
                        });
                      download(
                        new Blob([c.lines], { type: "text/calendar" }),
                        `haken-conflict-${c.id}.ics`,
                      );
                    }),
                },
                t("settings.export"),
              )
            : h(
                "button",
                {
                  type: "button",
                  class: "button",
                  onclick: () => ctx.run("ui.useConflict", () => ctx.app.useConflict(c.id)),
                },
                t("conflict.use"),
              ),
          h(
            "button",
            {
              type: "button",
              class: "button",
              onclick: () => ctx.run("ui.dismissConflict", () => ctx.app.dismissConflict(c.id)),
            },
            t("conflict.dismiss"),
          ),
        ),
      ),
    ),
  );
}

function steps(ctx: Ctx, item: TaskItem, readonly: boolean): HTMLElement {
  const input = h("input", {
    type: "text",
    class: "add-input",
    name: "step",
    placeholder: t("task.addStep"),
    "aria-label": t("task.addStep"),
    maxlength: "1000",
    autocomplete: "off",
  });
  return h(
    "section",
    { class: "steps", "aria-label": t("task.stepsTitle") },
    h(
      "ul",
      { class: "step-list" },
      item.steps.map((step) => {
        const v = step.view;
        if (v === null) return h("li", { class: "step invalid" }, t("task.readonly"));
        const title = h("input", {
          type: "text",
          class: v.done ? "step-title done" : "step-title",
          value: v.summary,
          "aria-label": t("task.stepTitle"),
          "data-focus": `step-${step.href}`,
          maxlength: "1000",
          disabled: readonly,
        });
        autosave(title, `${step.href} summary`, (raw) => {
          const value = raw.trim();
          if (value === "") return;
          ctx.run("ui.editStep", () => ctx.app.edit(step.href, { kind: "summary", value }));
        });
        return h(
          "li",
          { class: "step" },
          checkCircle(ctx, step, v, readonly),
          title,
          readonly
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "icon-button",
                  "aria-label": t("task.removeStep"),
                  onclick: () => ctx.run("ui.deleteStep", () => ctx.app.deleteTask(step.href)),
                },
                icon("close"),
              ),
        );
      }),
    ),
    readonly
      ? null
      : h(
          "form",
          {
            class: "add-step",
            onsubmit: (e: Event) => {
              e.preventDefault();
              ctx.run("ui.addStep", () =>
                submitField(input, (value) =>
                  ctx.app.addTask(item.list, value, { parentHref: item.href }),
                ),
              );
            },
          },
          h("span", { class: "icon-slot" }, icon("plus")),
          input,
        ),
  );
}

/** *Add to Focus* / *Remove from Focus*: the task stays on Focus until taken off. */
/** The list the task is in; choosing another one moves it there with its checklist. */
function listRow(ctx: Ctx, item: TaskItem, listId: ListId): HTMLElement {
  const lists = ctx.snapshot.lists.filter((l) => !l.errorlogs || l.href === item.list);
  return h(
    "div",
    { class: "group-row" },
    icon("list"),
    h("label", { for: "list-select", class: "row-label" }, t("task.list")),
    h(
      "select",
      {
        id: "list-select",
        onchange: (e: Event) => {
          const target = (e.target as HTMLSelectElement).value;
          ctx.run("ui.moveToList", async () => {
            const name = ctx.snapshot.lists.find((l) => l.href === target)?.name ?? "";
            const moved = await ctx.app.moveToList(item.href, target);
            ctx.notify(t("task.moved", { list: name }));
            // From a list screen, follow the task into its new list.
            ctx.navigate({
              kind: "task",
              list: listId.kind === "list" ? { kind: "list", href: target } : listId,
              task: moved,
            });
          });
        },
      },
      lists.map((l) => h("option", { value: l.href, selected: l.href === item.list }, l.name)),
    ),
  );
}

function focusRow(ctx: Ctx, item: TaskItem, view: TaskView): HTMLElement {
  const on = view.focus !== null;
  return h(
    "div",
    { class: "group-row" },
    icon("focus"),
    h(
      "button",
      {
        type: "button",
        class: on ? "row-button on" : "row-button",
        "aria-pressed": on ? "true" : "false",
        onclick: () =>
          ctx.run("ui.focus", () =>
            ctx.app.edit(item.href, { kind: "focus", value: on ? null : localDate(ctx.now) }),
          ),
      },
      on ? t("focus.remove") : t("focus.add"),
    ),
  );
}

function dueRow(ctx: Ctx, item: TaskItem, view: TaskView, readonly: boolean): HTMLElement {
  const value = view.due === null ? "" : dueDate(view.due);
  const id = "due-input";
  return h(
    "div",
    { class: "group-row" },
    icon("calendar"),
    h("label", { for: id, class: "row-label" }, t("task.setDue")),
    h("input", {
      id,
      type: "date",
      value,
      disabled: readonly,
      onchange: (e: Event) => {
        const v = (e.target as HTMLInputElement).value;
        ctx.run("ui.editDue", () =>
          ctx.app.edit(item.href, {
            kind: "due",
            value: v === "" ? null : { kind: "date", date: v },
          }),
        );
      },
    }),
    view.due !== null && !readonly
      ? h(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": t("task.removeDue"),
            onclick: () =>
              ctx.run("ui.removeDue", () => ctx.app.edit(item.href, { kind: "due", value: null })),
          },
          icon("close"),
        )
      : null,
  );
}

function labelsRow(ctx: Ctx, item: TaskItem, view: TaskView, readonly: boolean): HTMLElement {
  const input = h("input", {
    type: "text",
    class: "label-input",
    name: "label",
    placeholder: t("task.addLabel"),
    "aria-label": t("task.addLabel"),
    maxlength: "100",
    autocomplete: "off",
  });
  return h(
    "div",
    { class: "group-row wrap" },
    icon("tag"),
    h(
      "ul",
      { class: "chips", "aria-label": t("task.labels") },
      view.categories.map((label) =>
        h(
          "li",
          { class: "chip" },
          label,
          readonly
            ? null
            : h(
                "button",
                {
                  type: "button",
                  class: "chip-remove",
                  "aria-label": t("task.removeLabel", { label }),
                  onclick: () =>
                    ctx.run("ui.removeLabel", () =>
                      ctx.app.edit(item.href, {
                        kind: "categories",
                        value: view.categories.filter((c) => c !== label),
                      }),
                    ),
                },
                icon("close", "icon small"),
              ),
        ),
      ),
    ),
    readonly
      ? null
      : h(
          "form",
          {
            class: "add-label",
            onsubmit: (e: Event) => {
              e.preventDefault();
              ctx.run("ui.addLabel", () =>
                submitField(input, (value) =>
                  ctx.app.edit(item.href, {
                    kind: "categories",
                    value: [...view.categories, value],
                  }),
                ),
              );
            },
          },
          input,
        ),
  );
}

function attachmentName(ctx: Ctx, item: TaskItem, a: Attachment, name: string): HTMLElement {
  if (a.kind === "binary")
    return h(
      "button",
      {
        type: "button",
        class: "attachment-name",
        onclick: () =>
          ctx.run("ui.download", async () => {
            const { blob, filename } = await ctx.app.attachmentBlob(item.href, a.index);
            download(blob, filename);
          }),
      },
      icon("download", "icon small"),
      name,
    );
  // Only web links are clickable; any other scheme (javascript:, data:, file:) is shown as text.
  if (!/^https?:\/\/[^\s]+$/i.test(a.uri))
    return h("span", { class: "attachment-name" }, icon("link", "icon small"), name);
  return h(
    "a",
    { class: "attachment-name", href: a.uri, rel: "noopener noreferrer", target: "_blank" },
    icon("link", "icon small"),
    name,
  );
}

function attachmentItem(ctx: Ctx, item: TaskItem, a: Attachment, readonly: boolean): HTMLElement {
  const name = a.filename ?? (a.kind === "uri" ? a.uri : t("task.attachment"));
  return h(
    "li",
    { class: "attachment" },
    attachmentName(ctx, item, a, name),
    a.kind === "binary" ? h("span", { class: "size" }, formatSize(a.size, locale())) : null,
    readonly
      ? null
      : h(
          "button",
          {
            type: "button",
            class: "icon-button",
            "aria-label": t("task.removeAttachment", { name }),
            onclick: () =>
              ctx.run("ui.removeAttachment", () =>
                ctx.app.edit(item.href, { kind: "removeAttachment", index: a.index }),
              ),
          },
          icon("close"),
        ),
  );
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename, class: "hidden" });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function attachmentsRow(ctx: Ctx, item: TaskItem, view: TaskView, readonly: boolean): HTMLElement {
  const file = h("input", {
    type: "file",
    class: "visually-hidden",
    id: "attach-input",
    onchange: (e: Event) => {
      const input = e.target as HTMLInputElement;
      const chosen = input.files?.[0];
      input.value = "";
      if (chosen === undefined) return;
      if (chosen.size > ATTACHMENT_LIMIT) {
        ctx.notify(t("task.attachmentTooLarge"));
        return;
      }
      ctx.run("ui.attach", async () => {
        const result = await ctx.app.attach(item.href, chosen);
        if (result.kind === "too-large") ctx.notify(t("task.attachmentTooLarge"));
        if (result.kind === "task-too-large") ctx.notify(t("task.taskTooLarge"));
      });
    },
  });
  return h(
    "div",
    { class: "group-row wrap" },
    icon("paperclip"),
    h(
      "ul",
      { class: "attachments", "aria-label": t("task.attachments") },
      view.attachments.map((a) => attachmentItem(ctx, item, a, readonly)),
    ),
    item.tooLarge
      ? h("p", { class: "field-error", role: "alert" }, t("task.serverTooLarge"))
      : null,
    readonly ? null : h("label", { for: "attach-input", class: "button" }, t("task.attach")),
    readonly ? null : file,
  );
}

export class HakenTask extends HTMLElement {
  render(ctx: Ctx, listId: ListId, href: string): void {
    const item = ctx.app.findItem(href);
    const closeHref = toHash({ kind: "list", list: listId });
    const close = h(
      "a",
      { class: "icon-button close", href: closeHref, "aria-label": t("task.close") },
      icon("close"),
    );
    if (item === null) {
      fill(
        this,
        h("header", { class: "detail-header" }, close),
        h("p", { class: "empty" }, t("task.missing")),
      );
      return;
    }
    if (item.view === null) {
      fill(
        this,
        h("header", { class: "detail-header" }, close),
        h("h2", { class: "task-heading" }, icon("alert"), t("task.readonly")),
        h("p", {}, t("task.readonlyHint")),
        conflicts(ctx, item),
      );
      return;
    }
    const view = item.view;
    const readonly = view.repeats && view.recurrence === null;
    const listName = ctx.snapshot.lists.find((l) => l.href === item.list)?.name ?? "";
    const back = h("a", { class: "back", href: closeHref }, icon("back"), h("span", {}, listName));
    const title = h("textarea", {
      class: view.done ? "task-heading-input done" : "task-heading-input",
      rows: "1",
      maxlength: "1000",
      "aria-label": t("task.title"),
      "data-focus": "title",
      disabled: readonly,
      onkeydown: (e: Event) => {
        if ((e as KeyboardEvent).key === "Enter") {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
      },
    });
    title.value = view.summary;
    autosave(title, `${item.href} summary`, (raw) => {
      const value = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== "")
        .join(" ");
      if (value === "") return;
      ctx.run("ui.editTitle", () => ctx.app.edit(item.href, { kind: "summary", value }));
    });
    const note = h("textarea", {
      class: "note",
      rows: "4",
      placeholder: t("task.note"),
      "aria-label": t("task.note"),
      "data-focus": "note",
      disabled: readonly,
    });
    note.value = view.description;
    autosave(note, `${item.href} description`, (value) =>
      ctx.run("ui.editNote", () => ctx.app.edit(item.href, { kind: "description", value })),
    );
    const deleteDialog = ctx.dialog;
    const confirmDelete = (): void => {
      fill(
        deleteDialog,
        h(
          "form",
          { method: "dialog" },
          h("h2", {}, t("task.delete")),
          h("p", {}, t("task.deleteConfirm")),
          h(
            "div",
            { class: "actions" },
            h("button", { type: "submit", class: "button", autofocus: true }, t("common.cancel")),
            h(
              "button",
              {
                type: "button",
                class: "button danger",
                onclick: () => {
                  deleteDialog.close();
                  ctx.run("ui.deleteTask", async () => {
                    await ctx.app.deleteTask(item.href);
                    ctx.navigate({ kind: "list", list: listId });
                  });
                },
              },
              t("common.delete"),
            ),
          ),
        ),
      );
      deleteDialog.showModal();
    };

    fill(
      this,
      h("header", { class: "detail-header" }, back, close),
      h(
        "div",
        { class: "task-head" },
        checkCircle(ctx, item, view, readonly),
        title,
        starButton(ctx, item, view, readonly),
      ),
      readonly ? h("p", { class: "hint" }, t("task.repeats")) : null,
      conflicts(ctx, item),
      view.parentUid === null ? steps(ctx, item, readonly) : null,
      h(
        "section",
        { class: "group" },
        view.parentUid === null && !readonly ? focusRow(ctx, item, view) : null,
        view.parentUid === null && !readonly ? listRow(ctx, item, listId) : null,
        dueRow(ctx, item, view, readonly),
        view.parentUid === null && !readonly ? repeatRow(ctx, item, view) : null,
        labelsRow(ctx, item, view, readonly),
        attachmentsRow(ctx, item, view, readonly),
      ),
      note,
      h(
        "footer",
        { class: "detail-footer" },
        h(
          "span",
          {},
          view.created === null
            ? ""
            : t("task.created", { date: formatDate(view.created, { dateStyle: "medium" }) }),
        ),
        readonly
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "icon-button",
                "aria-label": t("task.delete"),
                onclick: confirmDelete,
              },
              icon("trash"),
            ),
      ),
    );
  }
}
