/** Lists screen / desktop sidebar (chapter 8, Screens: Lists). */

import { type Ctx, syncStatus } from "../context.js";
import { makeSortable } from "../dnd/sortable.js";
import { fill, h } from "../dom.js";
import { t, tp } from "../i18n.js";
import { type IconName, icon } from "../icons.js";
import { type ListId, SMART, type SmartId, sameList, toHash } from "../route.js";
import { smartCount } from "../views.js";

const SMART_ICON: Readonly<Record<SmartId, IconName>> = {
  focus: "focus",
  important: "star",
  planned: "calendar",
  all: "inbox",
};

export function smartName(id: SmartId): string {
  switch (id) {
    case "focus":
      return t("smart.focus");
    case "important":
      return t("smart.important");
    case "planned":
      return t("smart.planned");
    case "all":
      return t("smart.all");
  }
}

function selected(ctx: Ctx, id: ListId): boolean {
  const r = ctx.route;
  return (r.kind === "list" || r.kind === "task") && sameList(r.list, id);
}

function row(
  ctx: Ctx,
  id: ListId,
  iconName: IconName,
  name: string,
  count: number,
  options: { readonly sortable?: boolean; readonly color?: string | null } = {},
): HTMLElement {
  const href = toHash({ kind: "list", list: id });
  const glyph = icon(iconName);
  // The list's own colour (calendar-color) as an SVG presentation attribute: no inline style.
  if (options.color != null) glyph.setAttribute("color", options.color.slice(0, 7));
  const sortable = options.sortable === true && id.kind === "list";
  return h(
    "li",
    {
      class: "list-item",
      "data-sortable": sortable ? "" : undefined,
      "data-href": id.kind === "list" ? id.href : undefined,
    },
    h(
      "a",
      {
        class: "list-row",
        href,
        "aria-current": selected(ctx, id) ? "page" : undefined,
        "data-drop": id.kind === "smart" && id.id === "focus" ? "focus" : undefined,
        // Keyboard reordering (Alt+↑/↓) keeps focus across the re-render.
        "data-focus": sortable ? `list-${href}` : undefined,
        "aria-keyshortcuts": sortable ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
      },
      glyph,
      h("span", { class: "list-name" }, name),
      count > 0 ? h("span", { class: "count" }, String(count)) : null,
    ),
  );
}

const STALE_DAYS = 3;

/** Warning after 3 days without a successful sync (ADR-20261103-sync-strategy). */
function staleWarning(ctx: Ctx): HTMLElement | null {
  const s = ctx.snapshot;
  if (s.account?.type !== "server" || s.lastSync === null) return null;
  const days = Math.floor((ctx.now - s.lastSync) / 86_400_000);
  return days >= STALE_DAYS
    ? h("p", { class: "warning small", role: "status" }, tp("sync.stale", days))
    : null;
}

export class HakenSidebar extends HTMLElement {
  render(ctx: Ctx): void {
    const input = h("input", {
      class: "new-list-input",
      type: "text",
      name: "list",
      placeholder: t("lists.newPlaceholder"),
      "aria-label": t("lists.newPlaceholder"),
      maxlength: "200",
      autocomplete: "off",
    });
    const form = h(
      "form",
      {
        class: "new-list",
        onsubmit: (e: Event) => {
          e.preventDefault();
          const name = input.value.trim();
          if (name === "") return;
          ctx.run("ui.createList", async () => {
            const href = await ctx.app.createList(name);
            ctx.navigate({ kind: "list", list: { kind: "list", href } });
          });
        },
      },
      h(
        "button",
        { class: "icon-button", type: "submit", "aria-label": t("lists.new") },
        icon("plus"),
      ),
      input,
    );
    fill(
      this,
      h(
        "header",
        { class: "app-header" },
        h("img", { class: "logo", src: "icons/icon.svg", alt: "", width: "28", height: "28" }),
        h("span", { class: "app-name" }, t("app.name")),
        h(
          "a",
          { class: "icon-button", href: "#/settings", "aria-label": t("nav.settings") },
          icon("settings"),
        ),
      ),
      h("div", { class: "sync-line" }, syncStatus(ctx), staleWarning(ctx)),
      h(
        "nav",
        { "aria-label": t("lists.title") },
        h(
          "ul",
          { class: "lists" },
          SMART.map((id) =>
            row(
              ctx,
              { kind: "smart", id },
              SMART_ICON[id],
              smartName(id),
              smartCount(ctx.snapshot, id, ctx.now),
            ),
          ),
        ),
        h("hr", { class: "divider" }),
        ownLists(ctx),
      ),
      form,
    );
  }
}

/** The user's lists, in server order (`calendar-order`); reorder by dragging the row. Errorlogs stays last. */
function ownLists(ctx: Ctx): HTMLElement {
  const ul = h(
    "ul",
    { class: "lists own-lists" },
    ctx.snapshot.lists.map((l) =>
      row(
        ctx,
        { kind: "list", href: l.href },
        l.errorlogs ? "alert" : "list",
        l.name,
        l.openCount,
        {
          sortable: !l.errorlogs,
          color: l.errorlogs ? null : l.color,
        },
      ),
    ),
  );
  makeSortable(ul, (href, index) => ctx.run("ui.moveList", () => ctx.app.moveList(href, index)));
  return ul;
}
