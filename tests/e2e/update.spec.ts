import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { guard, setupLocal } from "./helpers.js";

const VERSION = (JSON.parse(readFileSync("package.json", "utf8")) as { version: string }).version;

/** Sets a stored setting directly in IndexedDB, as an older version left it. */
async function storeSetting(page: Page, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    ([k, v]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open("haken");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const store = db.transaction("settings", "readwrite").objectStore("settings");
          const read = store.get("theme");
          read.onsuccess = () => {
            const schema = (read.result as { schema: unknown } | undefined)?.schema ?? 1;
            store.put({ schema, key: k, value: v });
            store.transaction.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        };
      }),
    [key, value] as const,
  );
}

test("after an update, What's new shows each unseen version once", async ({ page }) => {
  const problems = guard(page);
  await setupLocal(page);
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "What's new" }) });

  // A fresh setup has nothing new to show.
  await page.reload();
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  await expect(dialog).toHaveCount(0);

  await storeSetting(page, "seenVersion", "0.1.0");
  await page.reload();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 3 }).first()).toHaveText(`Version ${VERSION}`);
  await expect(dialog.getByRole("heading", { name: "Version 0.2.0" })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Version 0.1.0" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "OK" }).click();
  await expect(dialog).toHaveCount(0);

  await page.reload();
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("a new service worker offers a reload", async ({ page }) => {
  const problems = guard(page);
  await setupLocal(page);
  // Reload only once the worker controls the page, so the reloaded page starts controlled.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.reload();
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  const bar = page.getByRole("status").filter({ hasText: "A new version of Haken is ready." });
  await expect(bar).toBeHidden();

  // The event the browser fires when an updated worker takes over this page.
  await page.evaluate(() => navigator.serviceWorker.dispatchEvent(new Event("controllerchange")));
  await expect(bar).toBeVisible();
  await Promise.all([
    page.waitForEvent("load"),
    bar.getByRole("button", { name: "Reload" }).click(),
  ]);
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  await expect(bar).toBeHidden();
  expect(problems).toEqual([]);
});
