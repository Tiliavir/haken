import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addTask, button, guard, setupServer, waitSynced } from "./helpers.js";

function serverFiles(user: string): string[] {
  const root = join("e2e-data", "collections", "collection-root", user);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".Radicale")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ics")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(root);
  return out;
}

test("offline edit syncs after reconnect", async ({ page, context }) => {
  const problems = guard(page);
  await setupServer(page);
  await addTask(page, "Online task");
  await waitSynced(page);
  expect(serverFiles("dev").some((f) => f.includes("SUMMARY:Online task"))).toBe(true);

  await context.setOffline(true);
  await addTask(page, "Offline task");
  await page
    .locator(".task-row", { hasText: "Online task" })
    .getByRole("button", { name: "Mark as completed" })
    .click();
  await expect(page.locator(".sync-line .status")).toHaveText(/Offline|pending/, {
    timeout: 10_000,
  });
  expect(serverFiles("dev").some((f) => f.includes("SUMMARY:Offline task"))).toBe(false);

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSynced(page);
  const files = serverFiles("dev");
  expect(files.some((f) => f.includes("SUMMARY:Offline task"))).toBe(true);
  expect(
    files.some((f) => f.includes("SUMMARY:Online task") && f.includes("STATUS:COMPLETED")),
  ).toBe(true);
  // Problems from the offline phase are expected network errors in the console only.
  expect(
    problems.filter(
      (p) => !p.includes("ERR_INTERNET_DISCONNECTED") && !p.includes("Failed to load resource"),
    ),
  ).toEqual([]);
});

test("two clients edit the same task: newer wins, loser kept as note", async ({ browser }) => {
  const a = await browser.newContext();
  const b = await browser.newContext();
  const pa = await a.newPage();
  const pb = await b.newPage();
  await setupServer(pa, "eve");
  await addTask(pa, "Shared");
  await waitSynced(pa);
  await setupServer(pb, "eve");
  await expect(pb.locator(".task-row .title", { hasText: "Shared" })).toBeVisible();

  // A goes offline and edits first; B edits later and syncs.
  await a.setOffline(true);
  await pa.locator(".task-row .title", { hasText: "Shared" }).click();
  await pa.getByLabel("Title").fill("From A");
  await pa.getByLabel("Title").press("Enter");
  await pb.waitForTimeout(1100);
  await pb.locator(".task-row .title", { hasText: "Shared" }).click();
  await pb.getByLabel("Title").fill("From B");
  await pb.getByLabel("Title").press("Enter");
  await expect
    .poll(() => serverFiles("eve").some((f) => f.includes("SUMMARY:From B")), { timeout: 15_000 })
    .toBe(true);

  await a.setOffline(false);
  await pa.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(pa.getByLabel("Title")).toHaveValue("From B", { timeout: 15_000 });
  await expect(pa.locator(".conflict-value")).toHaveText("From A");
  await button(pa, "Use this value");
  await waitSynced(pa);
  await expect(pa.getByLabel("Title")).toHaveValue("From A");
  await a.close();
  await b.close();
});

test("logout with pending changes asks and can keep data", async ({ page, context }) => {
  await setupServer(page);
  await context.setOffline(true);
  await addTask(page, "Unsynced");
  await page.getByRole("link", { name: "Settings" }).click();
  await button(page, "Log out");
  await expect(page.getByText(/changes? (is|are) not on the server yet/)).toBeVisible({
    timeout: 15_000,
  });
  await button(page, "Log out, keep data on this device");
  await expect(page.getByRole("heading", { name: "Where should your tasks live?" })).toBeVisible();
});

test("gateway refuses another user's collection", async ({ page, request }) => {
  await setupServer(page);
  const status = await page.evaluate(
    async () => (await fetch("dav/eve/", { method: "PROPFIND", headers: { Depth: "0" } })).status,
  );
  expect(status).toBe(403);
  const anonymous = await request.fetch("/dav/dev/", { method: "PROPFIND" });
  expect(anonymous.status()).toBe(401);
});
