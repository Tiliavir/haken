import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { addTask, setupLocal, setupServer, waitSynced } from "./helpers.js";

const DAY = 86_400_000;

function serverFiles(user: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".Radicale")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ics")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join("e2e-data", "collections", "collection-root", user));
  return out;
}

function ymd(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function setDue(page: Page, title: string, date: string): Promise<void> {
  await page.locator("haken-list .task-row .title", { hasText: title }).click();
  await page.locator("#due-input").fill(date);
  // Several change events at once (fill, blur, a fast second tap): commands must queue, not race.
  await page.locator("#due-input").evaluate((el, final) => {
    const input = el as HTMLInputElement;
    for (const value of ["2026-12-24", "2026-12-25", final]) {
      input.value = value;
      input.dispatchEvent(new Event("change"));
    }
  }, date);
  await expect(
    page.locator("haken-list .task-row", { hasText: title }).locator(".meta"),
  ).toBeVisible();
}

const todayTitles = (page: Page) =>
  page.locator("haken-list > .tasks .task-row .title").allInnerTexts();

test("Today: overdue (red) and due (!) on top, then tasks put on Today; they stay the next day", async ({
  page,
}) => {
  const start = new Date("2026-11-04T09:00:00").getTime();
  await page.clock.install({ time: start });
  await setupLocal(page);
  for (const title of ["Pinned", "Overdue", "Due today", "Elsewhere"]) await addTask(page, title);
  await setDue(page, "Overdue", ymd(start - 2 * DAY));
  await setDue(page, "Due today", ymd(start));
  await page.locator("haken-list .task-row .title", { hasText: "Pinned" }).click();
  await page.getByRole("button", { name: "Add to Today" }).click();
  await expect(page.getByRole("button", { name: "Remove from Today" })).toBeVisible();

  await page.getByRole("link", { name: /^Today/ }).click();
  await expect.poll(() => todayTitles(page)).toEqual(["Overdue", "Due today", "Pinned"]);
  const overdue = page.locator(".task-row", { hasText: "Overdue" }).locator(".meta-item.overdue");
  await expect(overdue).toContainText("Overdue");
  expect(await overdue.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(161, 38, 43)");
  await expect(
    page.locator(".task-row", { hasText: "Due today" }).locator(".meta-item.due-today"),
  ).toBeVisible();

  // Next day: due-today is now overdue, the pinned task is still there.
  await page.clock.setFixedTime(start + DAY);
  await page.reload();
  await page.getByRole("link", { name: /^Today/ }).click();
  await expect.poll(() => todayTitles(page)).toEqual(["Overdue", "Due today", "Pinned"]);
  await expect(
    page.locator(".task-row", { hasText: "Due today" }).locator(".meta-item.overdue"),
  ).toBeVisible();

  // A task added in Today goes on Today without a due date.
  await addTask(page, "Added here");
  await expect
    .poll(() => todayTitles(page))
    .toEqual(["Overdue", "Due today", "Added here", "Pinned"]);
  await expect(
    page.locator(".task-row", { hasText: "Added here" }).locator(".meta-item.on-today"),
  ).toBeVisible();
  // No unexpected error anywhere in this flow.
  await expect(page.getByRole("link", { name: /errorlogs/ })).toHaveCount(0);
});

test("drag a task onto Today in the sidebar; it syncs as X-HAKEN-MYDAY", async ({ page }) => {
  await setupServer(page);
  await addTask(page, "Drag me to Today");
  const grip = page.getByRole("button", { name: "Move “Drag me to Today”" });
  const target = page.getByRole("link", { name: /^Today/ });
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(page.locator(".toast")).toHaveText("Added to Today.");
  await expect(
    page.locator(".task-row", { hasText: "Drag me to Today" }).locator(".meta-item.on-today"),
  ).toBeVisible();
  await waitSynced(page);
  await expect
    .poll(
      () =>
        serverFiles("dev").some(
          (f) => f.includes("SUMMARY:Drag me to Today") && /X-HAKEN-MYDAY:\d{8}/.test(f),
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  await target.click();
  await expect(page.locator(".task-row .title", { hasText: "Drag me to Today" })).toBeVisible();
});
