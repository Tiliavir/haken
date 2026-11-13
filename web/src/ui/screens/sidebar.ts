/** Lists screen / desktop sidebar (chapter 8, Screens: Lists). */

import { moveLabel } from "../../domain/labels.js";
import { type Ctx, syncStatus } from "../context.js";
import { makeSortable } from "../dnd/sortable.js";
import { fill, h } from "../dom.js";
import { collator, t, tp } from "../i18n.js";
import { type IconName, icon } from "../icons.js";
import { type ListId, SMART, type SmartId, sameList, toHash } from "../route.js";
import { labelCount, labelNames, smartCount } from "../views.js";

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
  options: {
    readonly sortable?: boolean;
    readonly color?: string | null;
    readonly emoji?: string | undefined;
  } = {},
): HTMLElement {
  const href = toHash({ kind: "list", list: id });
  let glyph: Element;
  if (options.emoji === undefined) {
    glyph = icon(iconName);
    // The list's own colour (calendar-color) as an SVG presentation attribute: no inline style.
    if (options.color != null) glyph.setAttribute("color", options.color.slice(0, 7));
  } else {
    glyph = h("span", { class: "icon emoji", "aria-hidden": "true" }, options.emoji);
  }
  const sortable = options.sortable === true;
  return h(
    "li",
    {
      class: "list-item",
      "data-sortable": sortable ? "" : undefined,
      // The key the sortable hands back: a list's href, a label's name.
      "data-href": sortKey(id),
      "data-label": sortable ? name : undefined,
    },
    h(
      "a",
      {
        class: "list-row",
        href,
        "aria-current": selected(ctx, id) ? "page" : undefined,
        "data-drop": dropTarget(id),
        // Focus survives a re-render (Alt+↑/↓) and can move here after a delete.
        "data-focus": `list-${href}`,
        "aria-keyshortcuts": sortable ? "Alt+ArrowUp Alt+ArrowDown" : undefined,
      },
      glyph,
      h("span", { class: "list-name" }, name),
      count > 0 ? h("span", { class: "count" }, String(count)) : null,
    ),
  );
}

function sortKey(id: ListId): string | undefined {
  if (id.kind === "list") return id.href;
  return id.kind === "label" ? id.name : undefined;
}

/** Drop targets for task rows: *Focus* and labels (ADR-20261108-label-views). */
function dropTarget(id: ListId): string | undefined {
  if (id.kind === "label") return `label:${id.name}`;
  return id.kind === "smart" && id.id === "focus" ? "focus" : undefined;
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
    const labels = labelSection(ctx);
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
        labels,
        labels === null ? null : h("h2", { class: "section-title" }, t("lists.title")),
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

/**
 * Labels in use, as views, above the lists (ADR-20261108-label-edit); hidden while there are none.
 * Reordered by dragging the row, kept on this device (ADR-20261111-label-order);
 * an emoji set for a label replaces its tag icon (ADR-20261113-label-emoji).
 */
function labelSection(ctx: Ctx): HTMLElement | null {
  const names = labelNames(ctx.snapshot, collator());
  if (names.length === 0) return null;
  const ul = h(
    "ul",
    { class: "lists" },
    names.map((name) =>
      row(ctx, { kind: "label", name }, "tag", name, labelCount(ctx.snapshot, name), {
        sortable: true,
        emoji: ctx.snapshot.labelEmoji.get(name),
      }),
    ),
  );
  // The order as shown now: a drag has already moved its row, and a re-render may still be pending.
  makeSortable(ul, (name, index) => {
    const shown = [...ul.querySelectorAll<HTMLElement>(":scope > [data-sortable]")].map(
      (li) => li.dataset["href"] ?? "",
    );
    ctx.run("ui.moveLabel", () => ctx.app.setLabelOrder(moveLabel(shown, name, index)));
  });
  return h(
    "section",
    { class: "labels", "aria-labelledby": "labels-title" },
    h("h2", { class: "section-title", id: "labels-title" }, t("labels.title")),
    ul,
  );
}
