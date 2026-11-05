/** Composition root: wires everything, registers the service worker. */
import { SyncScheduler } from "./app/scheduler.js";
import { AppService } from "./app/service.js";
import { serviceWorkerUrl } from "./net/trusted.js";
import { defineElements, type HakenApp } from "./ui/app-root.js";
import { h } from "./ui/dom.js";
import { initI18n, t } from "./ui/i18n.js";
import { captureInstallPrompt } from "./ui/platform.js";
import { applyTheme } from "./ui/theme.js";

/** The directory the app is served from, e.g. `/` or `/haken/`. */
function basePath(): string {
  const path = new URL(document.baseURI).pathname;
  return path.endsWith("/") ? path : path.slice(0, path.lastIndexOf("/") + 1);
}

async function main(): Promise<void> {
  captureInstallPrompt();
  defineElements();
  const root = document.querySelector<HakenApp>("haken-app");
  if (root === null) throw new Error("haken-app element missing");
  const app = await AppService.start(basePath());
  if (app === null) {
    await initI18n(null);
    applyTheme("system", null);
    root.replaceChildren(
      h(
        "div",
        { class: "setup-screen" },
        h("h1", { class: "page-title" }, t("blocked.title")),
        h("p", { class: "lead" }, t("blocked.text")),
      ),
    );
    return;
  }
  window.addEventListener("error", (e) => {
    void app.reporter.report(e.error ?? new Error(e.message), "window.error");
  });
  window.addEventListener("unhandledrejection", (e) => {
    void app.reporter.report(e.reason, "window.unhandledrejection");
  });
  await initI18n(app.snapshot.settings.locale);
  root.attach(app);
  new SyncScheduler(app).start();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event: MessageEvent<unknown>) => {
      const data = event.data;
      if (
        typeof data === "object" &&
        data !== null &&
        (data as { type?: unknown }).type === "sw-error"
      ) {
        const message = String((data as { message?: unknown }).message ?? "");
        void app.reporter.report(new Error(`Service worker: ${message}`), "sw");
      }
    });
    await navigator.serviceWorker.register(serviceWorkerUrl(), { type: "module", scope: "./" });
  }
}

main().catch((error: unknown) => {
  // Before the app service exists there is no errorlogs list to write to.
  console.error("[haken] start failed", error);
  const root = document.querySelector("haken-app");
  root?.replaceChildren(
    h(
      "div",
      { class: "setup-screen" },
      h("h1", { class: "page-title" }, "haken"),
      h("p", { class: "lead" }, String(error instanceof Error ? error.message : error)),
    ),
  );
});
