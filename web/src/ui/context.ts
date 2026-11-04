import type { AppService, Snapshot, SyncStatus } from "../app/service.js";
import { h } from "./dom.js";
import { t, tp } from "./i18n.js";
import type { Route } from "./route.js";

export interface Ctx {
  readonly app: AppService;
  readonly snapshot: Snapshot;
  readonly route: Route;
  readonly now: number;
  readonly navigate: (route: Route) => void;
  /** Runs a command; an unexpected error becomes an error task and a short notice. */
  readonly run: (operation: string, fn: () => Promise<unknown>) => void;
  readonly notify: (text: string) => void;
  readonly signIn: () => void;
  /** Renders again from the current snapshot (for screen-local state changes after an await). */
  readonly rerender: () => void;
  /** One modal dialog owned by the root; it survives re-renders, so a refresh never closes it. */
  readonly dialog: HTMLDialogElement;
}

export function statusText(status: SyncStatus): string {
  switch (status.kind) {
    case "local":
      return t("sync.local");
    case "synced":
      return t("sync.synced");
    case "pending":
      return tp("sync.pending", status.count);
    case "quarantined":
      return tp("sync.quarantined", status.count);
    case "syncing":
      return t("sync.syncing");
    case "offline":
      return t("sync.offline");
    case "signin":
      return t("sync.signin");
    case "error":
      return t("sync.error");
  }
}

/** Dot + text, always visible (chapter 8, States). */
export function syncStatus(ctx: Ctx): HTMLElement {
  const status = ctx.snapshot.status;
  const dot = h("span", { class: `dot dot-${status.kind}`, "aria-hidden": "true" });
  const label = statusText(status);
  if (status.kind === "signin") {
    return h(
      "button",
      { class: "status link", type: "button", onclick: () => ctx.signIn() },
      dot,
      label,
    );
  }
  if (status.kind === "error" || status.kind === "quarantined") {
    const errorlogs = ctx.snapshot.lists.find((l) => l.errorlogs);
    if (errorlogs !== undefined) {
      return h(
        "a",
        { class: "status link", href: `#/list/${encodeURIComponent(errorlogs.href)}` },
        dot,
        label,
      );
    }
  }
  return h("span", { class: "status", role: "status" }, dot, label);
}
