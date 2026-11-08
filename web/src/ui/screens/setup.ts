/**
 * First start and setup ([runtime view](../../../../docs/arc42/06-runtime-view.md#first-start-and-setup)).
 * Every step is stored before the next one is shown, so a reload resumes.
 */
import type { SetupStep } from "../../app/service.js";
import type { Ctx } from "../context.js";
import { fill, h } from "../dom.js";
import { t } from "../i18n.js";
import { icon } from "../icons.js";
import {
  consumeInstallPrompt,
  installPrompt,
  separateAppStorage,
  standalone,
} from "../platform.js";
import { chooseImport } from "./settings.js";

type Mode = "server" | "local";

function screen(title: string, ...children: (Node | string | null)[]): HTMLElement {
  return h(
    "div",
    { class: "setup-screen" },
    h("img", { class: "setup-logo", src: "icons/icon.svg", alt: "", width: "72", height: "72" }),
    h("h1", { class: "page-title" }, title),
    ...children,
  );
}

function actions(...buttons: (HTMLElement | null)[]): HTMLElement {
  return h("div", { class: "setup-actions" }, ...buttons);
}

function button(
  label: string,
  onclick: () => void,
  kind: "primary" | "plain" = "plain",
): HTMLButtonElement {
  return h(
    "button",
    { type: "button", class: kind === "primary" ? "button primary" : "button", onclick },
    label,
  );
}

type LoginFailure = Exclude<Awaited<ReturnType<Ctx["app"]["signIn"]>>, { kind: "ok" }>;

function signInError(result: LoginFailure): string {
  switch (result.kind) {
    case "invalid":
      return t("setup.signin.invalid");
    case "rate-limited":
      return t("setup.signin.rateLimited", { seconds: result.retryAfterSeconds });
    case "unreachable":
      return t("setup.signin.unreachable");
    case "insecure":
      return t("setup.signin.insecure");
  }
}

export class HakenSetup extends HTMLElement {
  private introPage = 0;
  private busy = false;
  private message: string | null = null;
  private unreachable = false;
  private persistDenied = false;

  render(ctx: Ctx): void {
    const step: SetupStep = ctx.snapshot.settings.setupStep ?? "welcome";
    const go = (next: SetupStep): void => {
      this.message = null;
      ctx.run("ui.setup.step", () => ctx.app.setSetupStep(next));
    };
    const modes = ctx.app.config.accounts;
    const afterIntro = (): SetupStep =>
      separateAppStorage(navigator.userAgent, navigator.maxTouchPoints) && !standalone()
        ? "install-first"
        : "mode";
    const afterAccount = (): SetupStep =>
      installPrompt() !== null || !standalone() ? "install" : "persist";
    const chooseMode = (mode: Mode): void => go(mode === "server" ? "signin" : "local");

    switch (step) {
      case "welcome": {
        const before = h(
          "details",
          { class: "setup-hint" },
          h("summary", {}, t("setup.usedBefore")),
          h("p", {}, t("setup.usedBeforeText")),
        );
        fill(
          this,
          screen(
            t("app.name"),
            h("p", { class: "lead" }, t("setup.welcome")),
            before,
            actions(button(t("setup.start"), () => go("intro"), "primary")),
          ),
        );
        return;
      }
      case "intro":
        this.renderIntro(ctx, go, afterIntro);
        return;
      case "install-first":
        fill(
          this,
          screen(
            t("setup.installFirst.title"),
            h("p", { class: "lead" }, t("setup.installFirst.text")),
            h("p", {}, t("setup.installFirst.howto")),
            this.message === null ? null : h("p", { class: "hint", role: "status" }, this.message),
            actions(
              button(t("setup.continueBrowser"), () => go("mode")),
              button(
                t("setup.installed"),
                () => {
                  this.message = t("setup.installFirst.openApp");
                  this.render(ctx);
                },
                "primary",
              ),
            ),
          ),
        );
        return;
      case "mode":
        this.renderMode(modes, chooseMode);
        return;
      case "signin":
        this.renderSignIn(ctx, go, afterAccount);
        return;
      case "local":
        this.renderLocal(ctx, go, afterAccount);
        return;
      case "install":
        this.renderInstall(ctx, go);
        return;
      case "persist":
        this.renderPersist(ctx);
        return;
    }
  }

  private renderIntro(ctx: Ctx, go: (s: SetupStep) => void, afterIntro: () => SetupStep): void {
    const pages = [
      [t("setup.intro1.title"), t("setup.intro1.text")],
      [t("setup.intro2.title"), t("setup.intro2.text")],
      [t("setup.intro3.title"), t("setup.intro3.text")],
    ] as const;
    const page = pages[this.introPage] ?? pages[0];
    const last = this.introPage >= pages.length - 1;
    fill(
      this,
      screen(
        page[0],
        h("p", { class: "lead" }, page[1]),
        h(
          "p",
          { class: "muted" },
          t("setup.page", { page: this.introPage + 1, total: pages.length }),
        ),
        actions(
          button(t("setup.skip"), () => go(afterIntro())),
          button(
            t("setup.next"),
            () => {
              if (last) {
                go(afterIntro());
                return;
              }
              this.introPage += 1;
              this.render(ctx);
            },
            "primary",
          ),
        ),
      ),
    );
  }

  private renderMode(modes: readonly Mode[], chooseMode: (m: Mode) => void): void {
    const single = modes.length === 1 ? modes[0] : undefined;
    if (single !== undefined) {
      chooseMode(single);
      return;
    }
    fill(
      this,
      screen(
        t("setup.mode.title"),
        h(
          "div",
          { class: "choices" },
          modes.map((m) =>
            h(
              "button",
              { type: "button", class: "choice", onclick: () => chooseMode(m) },
              h("strong", {}, m === "server" ? t("setup.mode.server") : t("setup.mode.local")),
              h(
                "span",
                {},
                m === "server" ? t("setup.mode.serverText") : t("setup.mode.localText"),
              ),
            ),
          ),
        ),
      ),
    );
  }

  private renderLocal(ctx: Ctx, go: (s: SetupStep) => void, afterAccount: () => SetupStep): void {
    const start = (withImport: boolean): void => {
      if (this.busy) return;
      this.busy = true;
      ctx.run("ui.setup.local", async () => {
        try {
          if (ctx.snapshot.account === null) await ctx.app.createLocalAccount();
          await ctx.app.setSetupStep(afterAccount());
          if (withImport) chooseImport(ctx, ctx.dialog);
        } finally {
          this.busy = false;
        }
      });
    };
    fill(
      this,
      screen(
        t("setup.local.title"),
        h("p", { class: "lead" }, t("setup.local.text")),
        h("p", { class: "warning" }, t("setup.localWarning")),
        ctx.app.config.demo ? h("p", { class: "warning" }, t("setup.demo")) : null,
        actions(
          ctx.app.config.accounts.length > 1 ? button(t("setup.back"), () => go("mode")) : null,
          button(t("setup.local.import"), () => start(true)),
          button(t("setup.local.empty"), () => start(false), "primary"),
        ),
      ),
    );
  }

  private renderInstall(ctx: Ctx, go: (s: SetupStep) => void): void {
    const prompt = installPrompt();
    if (prompt === null && standalone()) {
      go("persist");
      return;
    }
    fill(
      this,
      screen(
        t("setup.install.title"),
        h("p", { class: "lead" }, t("setup.install.text")),
        prompt === null ? h("p", {}, t("setup.install.howto")) : null,
        actions(
          button(t("setup.later"), () => {
            ctx.run("ui.setup.installLater", async () => {
              await ctx.app.setSetting("installOffered", true);
              await ctx.app.setSetupStep("persist");
            });
          }),
          prompt === null
            ? null
            : button(
                t("setup.install.button"),
                () =>
                  ctx.run("ui.setup.install", async () => {
                    await prompt.prompt();
                    await prompt.userChoice;
                    consumeInstallPrompt();
                    await ctx.app.setSetting("installOffered", true);
                    await ctx.app.setSetupStep("persist");
                  }),
                "primary",
              ),
        ),
      ),
    );
  }

  private renderPersist(ctx: Ctx): void {
    const done = (): void => ctx.run("ui.setup.finish", () => ctx.app.finishSetup());
    fill(
      this,
      screen(
        t("setup.persist.title"),
        h("p", { class: "lead" }, t("setup.persist.text")),
        this.persistDenied
          ? h("p", { class: "warning", role: "status" }, t("setup.persist.denied"))
          : null,
        actions(
          button(this.persistDenied ? t("setup.continue") : t("setup.later"), done),
          this.persistDenied
            ? null
            : button(
                t("setup.persist.allow"),
                () =>
                  ctx.run("ui.setup.persist", async () => {
                    const granted = await navigator.storage.persist();
                    if (granted) {
                      await ctx.app.finishSetup();
                      return;
                    }
                    this.persistDenied = true;
                    ctx.rerender();
                  }),
                "primary",
              ),
        ),
      ),
    );
  }

  private renderSignIn(ctx: Ctx, go: (s: SetupStep) => void, afterAccount: () => SetupStep): void {
    const user = h("input", {
      id: "user",
      name: "username",
      type: "text",
      autocomplete: "username",
      required: true,
      autocapitalize: "none",
      spellcheck: "false",
    });
    const password = h("input", {
      id: "password",
      name: "password",
      type: "password",
      autocomplete: "current-password",
      required: true,
    });
    const submit = h(
      "button",
      { type: "submit", class: "button primary", disabled: this.busy },
      this.busy ? t("setup.signin.busy") : t("setup.signin.submit"),
    );
    const form = h(
      "form",
      {
        class: "signin",
        onsubmit: (e: Event) => {
          e.preventDefault();
          if (this.busy) return;
          this.busy = true;
          this.message = null;
          this.unreachable = false;
          this.render(ctx);
          ctx.run("ui.setup.signin", async () => {
            try {
              const result = await ctx.app.signIn(user.value.trim(), password.value);
              password.value = "";
              if (result.kind === "ok") {
                await ctx.app.setSetupStep(afterAccount());
                return;
              }
              this.message = signInError(result);
              this.unreachable = result.kind === "unreachable";
            } finally {
              this.busy = false;
              ctx.rerender();
            }
          });
        },
      },
      h("label", { for: "user" }, t("setup.signin.user")),
      user,
      h("label", { for: "password" }, t("setup.signin.password")),
      password,
      this.message === null
        ? null
        : h(
            "p",
            { class: "field-error", role: "alert" },
            icon("alert", "icon small"),
            this.message,
          ),
      this.unreachable && ctx.app.config.accounts.includes("local")
        ? h(
            "div",
            { class: "warning" },
            h("p", {}, t("setup.localWarning")),
            button(t("setup.signin.startLocal"), () => go("local")),
          )
        : null,
      actions(
        ctx.app.config.accounts.length > 1 ? button(t("setup.back"), () => go("mode")) : null,
        submit,
      ),
    );
    fill(
      this,
      screen(
        t("setup.signin.title"),
        h("p", { class: "lead" }, t("setup.signin.text", { server: location.host })),
        form,
      ),
    );
  }
}

/** Dialog to sign in again when the session expired (*Sign in to sync*). */
export function reauthDialog(ctx: Ctx, dialog: HTMLDialogElement): void {
  const password = h("input", {
    id: "reauth-password",
    type: "password",
    autocomplete: "current-password",
    required: true,
  });
  const error = h("p", { class: "field-error", role: "alert", hidden: true });
  fill(
    dialog,
    h(
      "form",
      {
        onsubmit: (e: Event) => {
          e.preventDefault();
          ctx.run("ui.reauth", async () => {
            const result = await ctx.app.reauthenticate(password.value);
            password.value = "";
            if (result.kind === "ok") {
              dialog.close();
              return;
            }
            error.hidden = false;
            error.textContent = signInError(result);
          });
        },
      },
      h("h2", {}, t("setup.signin.title")),
      h("p", {}, t("reauth.text", { user: ctx.snapshot.account?.user ?? "" })),
      // Lets password managers match the saved login; never shown or edited.
      h("input", {
        type: "text",
        name: "username",
        autocomplete: "username",
        value: ctx.snapshot.account?.user ?? "",
        readonly: true,
        hidden: true,
      }),
      h("label", { for: "reauth-password" }, t("setup.signin.password")),
      password,
      error,
      h(
        "div",
        { class: "actions" },
        h(
          "button",
          { type: "button", class: "button", onclick: () => dialog.close() },
          t("common.cancel"),
        ),
        h("button", { type: "submit", class: "button primary" }, t("setup.signin.submit")),
      ),
    ),
  );
  dialog.showModal();
}
