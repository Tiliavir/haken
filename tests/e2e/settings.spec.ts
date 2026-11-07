import { expect, type Page, test } from "@playwright/test";
import { addTask, button, guard, setupLocal } from "./helpers.js";

/** iPhone Safari: installed apps get their own storage (web/src/ui/platform.ts). */
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function openSettings(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
}

/** The page background and the resolved `--accent`, as the browser paints them. */
const painted = (page: Page) =>
  page.evaluate(() => {
    const probe = document.createElement("span");
    probe.setAttribute("data-probe", "");
    document.body.append(probe);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync("[data-probe]{color:var(--accent)}");
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    const accent = getComputedStyle(probe).color;
    probe.remove();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    return {
      theme: document.documentElement.dataset["theme"] ?? "system",
      background: getComputedStyle(document.body).backgroundColor,
      accent,
      themeColor: document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
    };
  });

const LIGHT = "rgb(255, 255, 255)";
const DARK = "rgb(18, 20, 22)";

test("attachments over 5 MB are refused in the UI; 5 MB exactly is attached", async ({ page }) => {
  const problems = guard(page);
  await setupLocal(page);
  await addTask(page, "Files");
  await page.locator(".task-row .title", { hasText: "Files" }).click();
  const limit = 5 * 1024 * 1024;
  await page.locator("#attach-input").setInputFiles({
    name: "big.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(limit + 1, 0x61),
  });
  await expect(page.locator(".toast")).toHaveText("Files larger than 5 MB cannot be attached.");
  await expect(page.locator(".attachment")).toHaveCount(0);
  await page.locator("#attach-input").setInputFiles({
    name: "fits.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.alloc(limit, 0x61),
  });
  await expect(page.locator(".attachment", { hasText: "fits.bin" })).toBeVisible();
  expect(problems).toEqual([]);
});

test("theme and accent colour apply at once and survive a reload", async ({ page }) => {
  const problems = guard(page);
  await page.emulateMedia({ colorScheme: "light" });
  await setupLocal(page);
  await openSettings(page);
  const start = await painted(page);
  expect(start).toMatchObject({ theme: "system", background: LIGHT, themeColor: "#ffffff" });

  // System follows the device.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await painted(page)).background).toBe(DARK);
  await page.emulateMedia({ colorScheme: "light" });

  await page.getByText("Dark", { exact: true }).click();
  await expect
    .poll(() => painted(page))
    .toMatchObject({ theme: "dark", background: DARK, themeColor: "#121416" });

  const accent = page.getByLabel("Accent colour");
  const darkDefault = (await painted(page)).accent;
  await accent.fill("#c0392b");
  await expect(page.locator(".hex")).toHaveText("#C0392B");
  await expect.poll(async () => (await painted(page)).accent).not.toBe(darkDefault);
  const custom = (await painted(page)).accent;

  await page.reload();
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect(accent).toHaveValue("#c0392b");
  expect(await painted(page)).toMatchObject({ theme: "dark", background: DARK, accent: custom });

  await page.getByText("Light", { exact: true }).click();
  await expect.poll(() => painted(page)).toMatchObject({ theme: "light", background: LIGHT });
  // Light mode on a dark device stays light.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(async () => (await painted(page)).background).toBe(LIGHT);

  await page.getByRole("button", { name: "Default" }).click();
  await expect(page.locator(".hex")).toHaveText("#1F4D45");
  await expect(page.getByRole("button", { name: "Default" })).toBeDisabled();
  expect(problems).toEqual([]);
});

test("language: switching reloads in that language; System language follows the browser", async ({
  page,
}) => {
  const problems = guard(page);
  await setupLocal(page);
  await openSettings(page);
  await page.getByLabel("Language").selectOption("de");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.getByLabel("Sprache")).toHaveValue("de");

  await page.getByLabel("Sprache").selectOption("");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  expect(problems).toEqual([]);
});

test("separate app storage (iPhone Safari user agent): setup asks to install first, the browser still works", async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: IPHONE_SAFARI });
  const page = await context.newPage();
  const problems = guard(page);
  await page.goto("/");
  await button(page, "Start");
  await button(page, "Skip");
  await expect(page.getByRole("heading", { name: "Install first" })).toBeVisible();
  await button(page, "I installed it");
  await expect(page.locator(".setup-screen .hint")).toHaveText(
    "Open Haken from your Home Screen or Dock now.",
  );
  // The step is stored: a reload (the app opened in the tab again) resumes it.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Install first" })).toBeVisible();

  await button(page, "Continue in the browser");
  await button(page, /Only on this device/);
  await button(page, "Start empty");
  await expect(page.getByRole("heading", { name: "Install Haken" })).toBeVisible();
  await button(page, "Later");
  await button(page, "Later");
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  expect(problems).toEqual([]);
  await context.close();
});

test("install: Chromium's install prompt is offered in setup", async ({ page }) => {
  const problems = guard(page);
  await page.goto("/");
  await button(page, "Start");
  // What Chromium fires once the app is installable; recorded instead of a browser dialog.
  await page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: () => {
        document.documentElement.dataset["prompted"] = "yes";
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: "accepted" }),
    });
    window.dispatchEvent(event);
  });
  await button(page, "Skip");
  await button(page, /Only on this device/);
  await button(page, "Start empty");
  await expect(page.getByRole("heading", { name: "Install Haken" })).toBeVisible();
  // With a prompt there is a button, not the manual how-to.
  await expect(page.getByText("Use your browser's menu", { exact: false })).toHaveCount(0);
  await button(page, "Install");
  await expect(page.locator("html")).toHaveAttribute("data-prompted", "yes");
  await expect(page.getByRole("heading", { name: "Keep data safe" })).toBeVisible();
  await button(page, "Later");
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  expect(problems).toEqual([]);
});
