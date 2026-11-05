/**
 * Actions for a task row without opening it: long-press on touch screens,
 * the context menu (right click, or long-press where the browser maps it) on
 * others. The same actions are on the task screen for keyboard users.
 */
import type { Ctx } from "../context.js";
import { fill, h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import { localDate } from "../views.js";

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 8;

export function rowActions(ctx: Ctx, container: HTMLElement): void {
  const open = (row: HTMLElement): void => {
    const href = row.dataset["href"];
    if (href === undefined || ctx.dialog.open) return;
    showSheet(ctx, href);
  };
  container.addEventListener("contextmenu", (e) => {
    const row = (e.target as Element | null)?.closest<HTMLElement>(".task-row[data-href]");
    if (row === null || row === undefined) return;
    e.preventDefault();
    open(row);
  });
  // iOS fires no contextmenu on long-press: time the touch ourselves.
  container.addEventListener("pointerdown", (e) => {
    if (
      e.pointerType !== "touch" ||
      (e.target as Element | null)?.closest(".grip, button, input") != null
    )
      return;
    const row = (e.target as Element | null)?.closest<HTMLElement>(".task-row[data-href]");
    if (row === null || row === undefined) return;
    const start = { x: e.clientX, y: e.clientY };
    let fired = false;
    const timer = setTimeout(() => {
      fired = true;
      open(row);
    }, LONG_PRESS_MS);
    const cancel = (): void => {
      clearTimeout(timer);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", cancel);
      row.removeEventListener("pointercancel", cancel);
    };
    const move = (m: PointerEvent): void => {
      if (Math.hypot(m.clientX - start.x, m.clientY - start.y) > MOVE_TOLERANCE_PX) cancel();
    };
    // A long-press must not also open the task.
    row.addEventListener(
      "click",
      (c) => {
        if (fired) c.preventDefault();
      },
      { once: true, capture: true },
    );
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", cancel);
    row.addEventListener("pointercancel", cancel);
  });
}

function showSheet(ctx: Ctx, href: string): void {
  const item = ctx.app.findItem(href);
  const view = item?.view ?? null;
  if (item === null || view === null || view.parentUid !== null) return;
  const dialog = ctx.dialog;
  const close = (): void => dialog.close();
  const onFocus = view.focus !== null;
  const lists = ctx.snapshot.lists.filter((l) => !l.errorlogs && l.href !== item.list);
  fill(
    dialog,
    h(
      "div",
      { class: "sheet" },
      h("h2", {}, view.summary === "" ? t("task.untitled") : view.summary),
      h(
        "button",
        {
          type: "button",
          class: "sheet-action",
          onclick: () => {
            close();
            ctx.run("ui.sheetFocus", async () => {
              await ctx.app.edit(href, {
                kind: "focus",
                value: onFocus ? null : localDate(Date.now()),
              });
              ctx.notify(onFocus ? t("focus.removed") : t("focus.added"));
            });
          },
        },
        icon("focus"),
        onFocus ? t("focus.remove") : t("focus.add"),
      ),
      lists.length === 0 ? null : h("p", { class: "sheet-label" }, t("task.moveTo")),
      lists.map((l) =>
        h(
          "button",
          {
            type: "button",
            class: "sheet-action",
            onclick: () => {
              close();
              ctx.run("ui.sheetMove", async () => {
                await ctx.app.moveToList(href, l.href);
                ctx.notify(t("task.moved", { list: l.name }));
              });
            },
          },
          icon("list"),
          l.name,
        ),
      ),
      h("button", { type: "button", class: "button", onclick: close }, t("common.cancel")),
    ),
  );
  dialog.showModal();
}
