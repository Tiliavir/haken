// Renders the app screens chapter 8 describes into docs/arc42/sketches/app/
// (`SCREENS=1 npx playwright test screens`). Synthetic data only.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { addTask, button, waitSynced } from "./helpers.js";

test.skip(process.env["SCREENS"] !== "1", "renders screenshots on request only");

const DIR = "docs/arc42/sketches/app";

async function phone(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    // A touch screen: the coarse-pointer sizes apply.
    hasTouch: true,
    isMobile: true,
    locale: "en-US",
    colorScheme: "light",
  });
  return context.newPage();
}

function onServer(user: string, text: string): boolean {
  const root = join("e2e-data", "collections", "collection-root", user);
  return readdirSync(root, { recursive: true })
    .filter((f) => f.endsWith(".ics"))
    .some((f) => readFileSync(join(root, f), "utf8").includes(text));
}

const shot = (page: Page, name: string): Promise<Buffer> =>
  page.screenshot({ path: `${DIR}/${name}.png` });

test("setup, empty list, offline, conflict note, logout", async ({ browser }) => {
  const page = await phone(browser);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await shot(page, "setup-1-welcome");
  await button(page, "Start");
  await shot(page, "setup-2-intro");
  await button(page, "Skip");
  await shot(page, "setup-3-storage");
  await button(page, /Sync with my server/);
  await page.getByLabel("User name").fill("eve");
  await shot(page, "setup-4-signin");
  await page.getByLabel("Password").fill("eve");
  await button(page, "Sign in");
  await expect(page.getByRole("heading", { name: "Install Haken" })).toBeVisible({
    timeout: 15_000,
  });
  await shot(page, "setup-5-install");
  await button(page, "Later");
  await shot(page, "setup-6-persist");
  await button(page, "Later");
  await waitSynced(page);
  await shot(page, "lists");
  await page.locator(".own-lists .list-row", { hasText: "Haken" }).click();
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  await shot(page, "list-empty");

  await page.context().setOffline(true);
  await addTask(page, "Water the plants");
  await addTask(page, "Call the plumber");
  await page.getByRole("link", { name: "Lists" }).click();
  await expect(page.locator(".sync-line .status")).toContainText("Offline");
  await shot(page, "lists-offline");
  await page.locator(".own-lists .list-row", { hasText: "Haken" }).click();

  // A second client changes the title while this one is offline: newer wins, the other is a note.
  await page.locator(".task-row .title", { hasText: "Water the plants" }).click();
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSynced(page);
  const other = await phone(browser);
  await other.goto("/");
  await button(other, "Start");
  await button(other, "Skip");
  await button(other, /Sync with my server/);
  await other.getByLabel("User name").fill("eve");
  await other.getByLabel("Password").fill("eve");
  await button(other, "Sign in");
  await button(other, "Later");
  await button(other, "Later");
  await other.locator(".own-lists .list-row", { hasText: "Haken" }).click();
  await page.context().setOffline(true);
  await page.getByLabel("Title").fill("Water the plants on the balcony");
  await page.getByLabel("Title").press("Enter");
  await other.waitForTimeout(1100);
  await other.locator(".task-row .title", { hasText: "Water the plants" }).click();
  await other.getByLabel("Title").fill("Water the plants in the kitchen");
  await other.getByLabel("Title").press("Enter");
  await expect.poll(() => onServer("eve", "SUMMARY:Water the plants in the kitchen")).toBe(true);
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.locator(".conflict-value")).toBeVisible({ timeout: 15_000 });
  await shot(page, "task-conflict");

  await page.context().setOffline(true);
  await page.getByLabel("Title").fill("Water the plants today");
  await page.getByLabel("Title").press("Enter");
  await page.goto("/#/settings");
  await button(page, "Log out");
  await expect(page.locator("dialog[open]")).toBeVisible({ timeout: 15_000 });
  await shot(page, "logout-pending");
});
