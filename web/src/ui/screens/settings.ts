/** Settings (chapter 8, Screens: Settings). */
import { APP_VERSION } from "../../app/errors.js";
import type { ImportPreview, Theme } from "../../app/service.js";
import { InvalidInputError } from "../../domain/errors.js";
import type { Ctx } from "../context.js";
import { statusText } from "../context.js";
import { fill, h } from "../dom.js";
import { formatDate, locales, t, tp } from "../i18n.js";
import { icon } from "../icons.js";
import { DEFAULT_ACCENT } from "../theme.js";
import { download } from "./task.js";

function card(title: string, ...children: (Node | null)[]): HTMLElement {
  return h("section", { class: "card" }, h("h2", { class: "card-title" }, title), ...children);
}

function exportFile(ctx: Ctx): void {
  ctx.run("ui.export", async () => {
    const text = await ctx.app.exportIcs();
    const date = new Date(ctx.now).toISOString().slice(0, 10);
    download(new Blob([text], { type: "text/calendar" }), `haken-${date}.ics`);
  });
}

export function importDialog(
  ctx: Ctx,
  dialog: HTMLDialogElement,
  preview: ImportPreview,
  done?: () => void,
): void {
  const lists = ctx.snapshot.lists.filter((l) => !l.errorlogs);
  const select = h(
    "select",
    { name: "import-list", "aria-label": t("import.list") },
    lists.map((l) => h("option", { value: l.href }, l.name)),
  );
  const problems = preview.result.problems;
  fill(
    dialog,
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, t("import.title")),
      h("p", {}, tp("import.summary", preview.result.items.length)),
      preview.replacing > 0
        ? h("p", { class: "warning" }, tp("import.replacing", preview.replacing))
        : null,
      problems.length > 0
        ? h(
            "div",
            { class: "warning" },
            h("p", {}, tp("import.problems", problems.length)),
            h(
              "ul",
              {},
              problems.map((p) =>
                h("li", {}, `${p.uid ?? `#${p.index + 1}`}: ${p.property} – ${p.message}`),
              ),
            ),
          )
        : null,
      h("label", {}, t("import.list"), select),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "button", autofocus: true }, t("common.cancel")),
        h(
          "button",
          {
            type: "button",
            class: "button primary",
            disabled: preview.result.items.length === 0 || lists.length === 0,
            onclick: () => {
              dialog.close();
              ctx.run("ui.import", async () => {
                await ctx.app.confirmImport(select.value, preview);
                ctx.notify(tp("import.done", preview.result.items.length));
                done?.();
              });
            },
          },
          t("import.confirm"),
        ),
      ),
    ),
  );
  dialog.showModal();
}

/** Opens a file picker and runs the import flow. */
export function chooseImport(ctx: Ctx, dialog: HTMLDialogElement, done?: () => void): void {
  const input = h("input", {
    type: "file",
    accept: ".ics,text/calendar",
    class: "visually-hidden",
  });
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    input.remove();
    if (file === undefined) return;
    ctx.run("ui.previewImport", async () => {
      try {
        const preview = await ctx.app.previewImport(await file.text());
        importDialog(ctx, dialog, preview, done);
      } catch (error) {
        // An unreadable file is user input: say so at the field, no error task.
        if (error instanceof InvalidInputError && error.layer === "domain") {
          ctx.notify(t("import.unreadable"));
          return;
        }
        throw error;
      }
    });
  });
  document.body.append(input);
  input.click();
}

const PENDING_FILE = "haken-pending.ics";

function confirmSaved(dialog: HTMLDialogElement, discard: () => void): void {
  fill(
    dialog,
    h(
      "form",
      { method: "dialog" },
      h("h2", {}, t("logout.title")),
      h("p", {}, t("logout.savedPrompt", { file: PENDING_FILE })),
      h(
        "div",
        { class: "actions" },
        h("button", { type: "submit", class: "button", autofocus: true }, t("common.cancel")),
        h(
          "button",
          { type: "button", class: "button danger", onclick: discard },
          t("logout.savedDelete"),
        ),
      ),
    ),
  );
}

function logoutFlow(ctx: Ctx, dialog: HTMLDialogElement): void {
  const account = ctx.snapshot.account;
  if (account === null) return;
  const finish = (choice: "delete" | "keep" | "discard") =>
    ctx.run("ui.logout", async () => {
      dialog.close();
      await ctx.app.logout(choice);
      ctx.navigate({ kind: "lists" });
    });
  if (account.type === "local") {
    fill(
      dialog,
      h(
        "form",
        { method: "dialog" },
        h("h2", {}, t("logout.title")),
        h("p", {}, t("logout.local")),
        h(
          "div",
          { class: "actions" },
          h("button", { type: "submit", class: "button", autofocus: true }, t("common.cancel")),
          h(
            "button",
            { type: "button", class: "button", onclick: () => exportFile(ctx) },
            t("settings.export"),
          ),
          h(
            "button",
            { type: "button", class: "button danger", onclick: () => finish("discard") },
            t("logout.deleteLocal"),
          ),
        ),
      ),
    );
    dialog.showModal();
    return;
  }
  ctx.run("ui.prepareLogout", async () => {
    const pending = await ctx.app.prepareLogout();
    if (pending === 0) {
      fill(
        dialog,
        h(
          "form",
          { method: "dialog" },
          h("h2", {}, t("logout.title")),
          h("p", {}, t("logout.synced")),
          h(
            "div",
            { class: "actions" },
            h("button", { type: "submit", class: "button", autofocus: true }, t("common.cancel")),
            h(
              "button",
              { type: "button", class: "button primary", onclick: () => finish("delete") },
              t("logout.ok"),
            ),
          ),
        ),
      );
      dialog.showModal();
      return;
    }
    const confirmInput = h("input", {
      type: "text",
      inputmode: "numeric",
      autocomplete: "off",
      name: "count",
    });
    const discard = h(
      "button",
      { type: "button", class: "button danger", disabled: true, onclick: () => finish("discard") },
      t("logout.discard"),
    );
    confirmInput.addEventListener("input", () => {
      discard.disabled = confirmInput.value.trim() !== String(pending);
    });
    fill(
      dialog,
      h(
        "form",
        { method: "dialog", class: "logout" },
        h("h2", {}, t("logout.title")),
        h("p", { class: "warning" }, tp("logout.pending", pending)),
        h(
          "div",
          { class: "stacked-actions" },
          h(
            "button",
            { type: "submit", class: "button primary", autofocus: true },
            t("common.cancel"),
          ),
          h(
            "button",
            { type: "button", class: "button", onclick: () => finish("keep") },
            t("logout.keep"),
          ),
          h(
            "button",
            {
              type: "button",
              class: "button",
              onclick: () =>
                ctx.run("ui.exportPending", async () => {
                  const text = await ctx.app.exportPendingIcs();
                  download(new Blob([text], { type: "text/calendar" }), PENDING_FILE);
                  // A download can be cancelled or fail unseen: delete only once the user says it is saved.
                  confirmSaved(dialog, () => finish("discard"));
                }),
            },
            t("logout.export"),
          ),
          h("label", {}, t("logout.discardPrompt", { count: pending }), confirmInput),
          discard,
        ),
      ),
    );
    dialog.showModal();
  });
}

export class HakenSettings extends HTMLElement {
  render(ctx: Ctx): void {
    const s = ctx.snapshot;
    const account = s.account;
    const dialog = ctx.dialog;
    const themeOptions: readonly Theme[] = ["system", "light", "dark"];
    const themeLabel = (v: Theme): string =>
      v === "system" ? t("theme.system") : v === "light" ? t("theme.light") : t("theme.dark");
    const accent = s.settings.accent ?? DEFAULT_ACCENT;
    const hex = h("output", { class: "hex" }, accent.toUpperCase());

    const accountCard =
      account === null
        ? null
        : card(
            t("settings.account"),
            h(
              "dl",
              { class: "facts" },
              h("dt", {}, t("settings.storage")),
              h("dd", {}, account.type === "local" ? t("settings.local") : t("settings.server")),
              account.type === "server" ? h("dt", {}, t("settings.serverLabel")) : null,
              account.type === "server" ? h("dd", {}, location.origin) : null,
              account.type === "server" ? h("dt", {}, t("settings.user")) : null,
              account.type === "server" ? h("dd", {}, account.user ?? "") : null,
            ),
            h(
              "button",
              { type: "button", class: "button", onclick: () => logoutFlow(ctx, dialog) },
              t("settings.logout"),
            ),
          );

    const syncCard =
      account?.type === "server"
        ? card(
            t("settings.sync"),
            h("p", {}, statusText(s.status)),
            h(
              "p",
              { class: "muted" },
              t("settings.lastSync", {
                time:
                  s.lastSync === null
                    ? t("settings.never")
                    : formatDate(s.lastSync, { dateStyle: "medium", timeStyle: "short" }),
              }),
            ),
            h("p", { class: "muted" }, tp("settings.pending", s.pending)),
            h(
              "button",
              {
                type: "button",
                class: "button",
                onclick: () => ctx.run("ui.syncNow", () => ctx.app.syncNow()),
              },
              t("settings.syncNow"),
            ),
          )
        : account?.type === "local"
          ? card(t("settings.sync"), h("p", { class: "warning" }, t("sync.localWarning")))
          : null;

    const appearance = card(
      t("settings.appearance"),
      h(
        "fieldset",
        { class: "segmented" },
        h("legend", {}, t("settings.theme")),
        themeOptions.map((v) =>
          h(
            "label",
            { class: "segment" },
            h("input", {
              type: "radio",
              name: "theme",
              value: v,
              checked: s.settings.theme === v,
              onchange: () => ctx.run("ui.theme", () => ctx.app.setSetting("theme", v)),
            }),
            h("span", {}, themeLabel(v)),
          ),
        ),
      ),
      h(
        "div",
        { class: "field-row" },
        h("label", { for: "accent" }, t("settings.accent")),
        h("input", {
          id: "accent",
          type: "color",
          value: accent,
          oninput: (e: Event) => {
            hex.textContent = (e.target as HTMLInputElement).value.toUpperCase();
          },
          onchange: (e: Event) => {
            const v = (e.target as HTMLInputElement).value.toLowerCase();
            ctx.run("ui.accent", () =>
              ctx.app.setSetting("accent", v === DEFAULT_ACCENT ? null : v),
            );
          },
        }),
        hex,
        h(
          "button",
          {
            type: "button",
            class: "button",
            disabled: s.settings.accent === null,
            onclick: () => ctx.run("ui.accentDefault", () => ctx.app.setSetting("accent", null)),
          },
          t("settings.accentDefault"),
        ),
      ),
      h(
        "div",
        { class: "field-row" },
        h("label", { for: "language" }, t("settings.language")),
        h(
          "select",
          {
            id: "language",
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              ctx.run("ui.language", async () => {
                await ctx.app.setSetting("locale", v === "" ? null : v);
                location.reload();
              });
            },
          },
          h(
            "option",
            { value: "", selected: s.settings.locale === null },
            t("settings.systemLanguage"),
          ),
          Object.entries(locales()).map(([tag, name]) =>
            h("option", { value: tag, selected: s.settings.locale === tag, lang: tag }, name),
          ),
        ),
      ),
    );

    const data =
      account === null
        ? null
        : card(
            t("settings.data"),
            h(
              "div",
              { class: "actions" },
              h(
                "button",
                { type: "button", class: "button", onclick: () => exportFile(ctx) },
                icon("download", "icon small"),
                t("settings.export"),
              ),
              h(
                "button",
                { type: "button", class: "button", onclick: () => chooseImport(ctx, dialog) },
                t("settings.import"),
              ),
            ),
          );

    fill(
      this,
      h(
        "header",
        { class: "list-header" },
        h("a", { class: "back", href: "#/" }, icon("back"), h("span", {}, t("lists.title"))),
        h("h1", { class: "page-title" }, t("settings.title")),
      ),
      accountCard,
      syncCard,
      appearance,
      data,
      h("p", { class: "muted version" }, t("settings.version", { version: APP_VERSION })),
    );
  }
}
