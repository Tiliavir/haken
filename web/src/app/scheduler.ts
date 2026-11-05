/**
 * Sync triggers (ADR-20261103-sync-strategy): app start, `online`, app
 * becomes visible, 2 s after the last edit, every 5 min while visible, and
 * every 30 s while the server is unreachable and the app is visible.
 */
import type { AppService } from "./service.js";

const AFTER_EDIT_MS = 2_000;
const VISIBLE_INTERVAL_MS = 5 * 60_000;
const OFFLINE_RETRY_MS = 30_000;

export class SyncScheduler {
  private editTimer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private retry: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly app: AppService) {}

  start(): void {
    this.app.addEventListener("edited", () => this.afterEdit());
    this.app.addEventListener("change", () => this.updateRetry());
    window.addEventListener("online", () => this.trigger("online"));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        this.trigger("visible");
        this.startInterval();
      } else {
        this.stopInterval();
      }
    });
    if (document.visibilityState === "visible") this.startInterval();
    this.trigger("start");
  }

  trigger(reason: string): void {
    if (this.app.activeAccount?.type !== "server" || this.app.activeAccount.ready !== true) return;
    this.app
      .syncNow()
      .catch((error: unknown) => this.app.reporter.report(error, `sync.trigger.${reason}`));
  }

  private afterEdit(): void {
    if (this.editTimer !== null) clearTimeout(this.editTimer);
    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.trigger("edit");
    }, AFTER_EDIT_MS);
  }

  private startInterval(): void {
    if (this.interval !== null) return;
    this.interval = setInterval(() => this.trigger("interval"), VISIBLE_INTERVAL_MS);
  }

  private stopInterval(): void {
    if (this.interval !== null) clearInterval(this.interval);
    this.interval = null;
  }

  private updateRetry(): void {
    const offline = this.app.syncResult === "offline";
    if (offline && this.retry === null) {
      this.retry = setInterval(() => {
        if (document.visibilityState === "visible") this.trigger("retry");
      }, OFFLINE_RETRY_MS);
    } else if (!offline && this.retry !== null) {
      clearInterval(this.retry);
      this.retry = null;
    }
  }
}
