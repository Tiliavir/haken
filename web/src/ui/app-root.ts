/**
 * `<haken-app>`: composition of the screens, routing and explicit
 * re-rendering. Every snapshot change renders the visible panes again;
 * nothing updates itself implicitly.
 */
import type { AppService } from "../app/service.js";
import type { Notice } from "../sync/runner.js";
import type { Ctx } from "./context.js";
import { isDragging, onDragEnd } from "./dnd/sortable.js";
import { fill, h } from "./dom.js";
import { t } from "./i18n.js";
import { type ListId, parseHash, type Route, toHash } from "./route.js";
import { HakenList } from "./screens/list.js";
import { HakenSettings } from "./screens/settings.js";
import { HakenSetup, reauthDialog } from "./screens/setup.js";
import { HakenSidebar } from "./screens/sidebar.js";
import { HakenTask } from "./screens/task.js";
import { applyTheme } from "./theme.js";
import { defaultList } from "./views.js";

export function defineElements(): void {
  customElements.define("haken-sidebar", HakenSidebar);
  customElements.define("haken-list", HakenList);
  customElements.define("haken-task", HakenTask);
  customElements.define("haken-settings", HakenSettings);
  customElements.define("haken-setup", HakenSetup);
  customElements.define("haken-app", HakenApp);
}

interface Focus {
  readonly key: string;
  readonly value: string | null;
  readonly start: number | null;
  readonly end: number | null;
}

export class HakenApp extends HTMLElement {
  private app: AppService | null = null;
  private readonly sidebar = new HakenSidebar();
  private readonly list = new HakenList();
  private readonly task = new HakenTask();
  private readonly settings = new HakenSettings();
  private readonly setup = new HakenSetup();
  private readonly toast = h("div", { class: "toast", role: "status", "aria-live": "polite" });
  private readonly reauth = h("dialog", { class: "dialog" });
  private readonly dialog = h("dialog", { class: "dialog" });
  private pending = false;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;

  attach(app: AppService): void {
    this.app = app;
    app.addEventListener("change", () => this.schedule());
    app.addEventListener("notice", (e) => this.onNotice((e as CustomEvent<Notice>).detail));
    window.addEventListener("hashchange", () => this.schedule());
    window
      .matchMedia("(prefers-color-scheme: dark)")
      .addEventListener("change", () => this.schedule());
    onDragEnd(() => {
      if (this.pending) this.schedule();
    });
    this.schedule();
  }

  private schedule(): void {
    if (isDragging()) {
      this.pending = true;
      return;
    }
    this.pending = false;
    this.render();
  }

  private ctx(app: AppService, route: Route): Ctx {
    return {
      app,
      snapshot: app.snapshot,
      route,
      now: Date.now(),
      navigate: (r) => {
        location.hash = toHash(r);
      },
      run: (operation, fn) => {
        fn().catch((error: unknown) => {
          this.notify(t("error.generic"));
          return app.reporter.report(error, operation);
        });
      },
      notify: (text) => this.notify(text),
      signIn: () => reauthDialog(this.ctx(app, route), this.reauth),
      rerender: () => this.schedule(),
      dialog: this.dialog,
    };
  }

  private render(): void {
    const app = this.app;
    if (app === null) return;
    const snapshot = app.snapshot;
    applyTheme(snapshot.settings.theme, snapshot.settings.accent);
    const focus = this.captureFocus();
    let route = parseHash(location.hash);
    const account = snapshot.account;
    if (account === null || !account.ready) {
      this.setup.render(this.ctx(app, route));
      fill(this, this.setup, this.toast, this.dialog);
      this.restoreFocus(focus);
      return;
    }
    // Desktop shows a list next to the sidebar; start with the first one.
    if (route.kind === "lists" && window.matchMedia("(min-width: 721px)").matches) {
      const first = defaultList(snapshot);
      if (first !== null) route = { kind: "list", list: { kind: "list", href: first.href } };
    }
    const ctx = this.ctx(app, route);
    this.sidebar.render(ctx);
    const panes: HTMLElement[] = [h("aside", { class: "pane pane-sidebar" }, this.sidebar)];
    let view: string = route.kind;
    if (route.kind === "settings") {
      this.settings.render(ctx);
      panes.push(h("main", { class: "pane pane-main" }, this.settings));
    } else if (route.kind === "list" || route.kind === "task") {
      const listId: ListId = route.list;
      this.list.render(ctx, listId);
      panes.push(h("main", { class: "pane pane-main" }, this.list));
      if (route.kind === "task") {
        this.task.render(ctx, listId, route.task);
        panes.push(
          h("section", { class: "pane pane-detail", "aria-label": t("task.detail") }, this.task),
        );
      }
    } else {
      view = "lists";
    }
    fill(
      this,
      h("div", { class: "shell", "data-view": view }, panes),
      this.toast,
      this.reauth,
      this.dialog,
    );
    this.restoreFocus(focus);
  }

  private captureFocus(): Focus | null {
    const el = document.activeElement;
    if (!(el instanceof HTMLElement) || !this.contains(el)) return null;
    const key = el.dataset["focus"] ?? (el.id === "" ? null : `#${el.id}`);
    if (key === null) return null;
    const editable =
      el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
    return {
      key,
      value: editable?.value ?? null,
      start: editable?.selectionStart ?? null,
      end: editable?.selectionEnd ?? null,
    };
  }

  /** Keeps focus and any text the user is still typing across a re-render. */
  private restoreFocus(focus: Focus | null): void {
    if (focus === null) return;
    const el = focus.key.startsWith("#")
      ? document.getElementById(focus.key.slice(1))
      : this.querySelector(`[data-focus="${CSS.escape(focus.key)}"]`);
    if (!(el instanceof HTMLElement)) return;
    if (
      (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) &&
      focus.value !== null
    ) {
      if (el.type !== "file" && el.type !== "color" && el.type !== "date") el.value = focus.value;
      if (focus.start !== null && focus.end !== null && el.type === "text")
        el.setSelectionRange(focus.start, focus.end);
      if (el instanceof HTMLTextAreaElement && focus.start !== null && focus.end !== null) {
        el.setSelectionRange(focus.start, focus.end);
      }
    }
    el.focus();
  }

  notify(text: string): void {
    this.toast.textContent = text;
    this.toast.classList.add("visible");
    if (this.toastTimer !== null) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toast.classList.remove("visible"), 5000);
  }

  private onNotice(notice: Notice): void {
    if (document.visibilityState !== "visible" || this.app === null) return;
    const item = this.app.findItem(notice.href);
    const title = item?.view?.summary ?? "";
    switch (notice.kind) {
      case "merged":
        this.notify(t("notice.merged", { title }));
        return;
      case "restored":
        this.notify(item === null ? t("notice.listRestored") : t("notice.restored", { title }));
        return;
      case "too-large":
        this.notify(t("task.serverTooLarge"));
        return;
    }
  }
}
