import { expect, type Page, test } from "@playwright/test";
import { addTask, serverFiles, setupLocal, setupServer, waitSynced } from "./helpers.js";

const DAY = 86_400_000;

function ymd(t: number): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

async function setDue(page: Page, title: string, date: string): Promise<void> {
  await page.locator("haken-list .task-row .title", { hasText: title }).click();
  // The detail pane switches asynchronously; fill only once it shows this task.
  await expect(page.getByLabel("Title")).toHaveValue(title);
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

const focusTitles = (page: Page) =>
  page.locator("haken-list .focus-part .task-row .title").allInnerTexts();

test("Focus: overdue (red) and due (!) on top, then tasks put on Focus; they stay the next day", async ({
  page,
}) => {
  const start = new Date("2026-11-04T09:00:00").getTime();
  await page.clock.install({ time: start });
  await setupLocal(page);
  for (const title of ["Pinned", "Overdue", "Due today", "Elsewhere"]) await addTask(page, title);
  await setDue(page, "Overdue", ymd(start - 2 * DAY));
  await setDue(page, "Due today", ymd(start));
  await page.locator("haken-list .task-row .title", { hasText: "Pinned" }).click();
  await expect(page.getByLabel("Title")).toHaveValue("Pinned");
  await page.getByRole("button", { name: "Add to Focus" }).click();
  await expect(page.getByRole("button", { name: "Remove from Focus" })).toBeVisible();

  await page.getByRole("link", { name: /^Focus/ }).click();
  await expect.poll(() => focusTitles(page)).toEqual(["Overdue", "Due today", "Pinned"]);
  const overdue = page.locator(".task-row", { hasText: "Overdue" }).locator(".meta-item.overdue");
  await expect(overdue).toContainText("Overdue");
  expect(await overdue.evaluate((el) => getComputedStyle(el).color)).toBe("rgb(161, 38, 43)");
  await expect(
    page.locator(".task-row", { hasText: "Due today" }).locator(".meta-item.due-today"),
  ).toBeVisible();

  // Next day: due-today is now overdue, the pinned task is still there.
  await page.clock.setFixedTime(start + DAY);
  await page.reload();
  await page.getByRole("link", { name: /^Focus/ }).click();
  await expect.poll(() => focusTitles(page)).toEqual(["Overdue", "Due today", "Pinned"]);
  await expect(
    page.locator(".task-row", { hasText: "Due today" }).locator(".meta-item.overdue"),
  ).toBeVisible();

  // A task added in Focus goes on Focus without a due date.
  await addTask(page, "Added here");
  await expect
    .poll(() => focusTitles(page))
    .toEqual(["Overdue", "Due today", "Added here", "Pinned"]);
  await expect(
    page.locator(".task-row", { hasText: "Added here" }).locator(".meta-item.on-focus"),
  ).toBeVisible();
  // No unexpected error anywhere in this flow.
  await expect(page.getByRole("link", { name: /errorlogs/ })).toHaveCount(0);
});

test("drag a task onto Focus in the sidebar; it syncs as X-HAKEN-FOCUS", async ({ page }) => {
  await setupServer(page);
  await addTask(page, "Drag me to Focus");
  const row = page.locator("haken-list .task-row .title", { hasText: "Drag me to Focus" });
  const target = page.getByRole("link", { name: /^Focus/ });
  const from = await row.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 10 });
  await expect(target).toHaveClass(/drop-target/);
  await page.mouse.up();
  await expect(page.locator(".toast")).toHaveText("Added to Focus.");
  await expect(
    page.locator(".task-row", { hasText: "Drag me to Focus" }).locator(".meta-item.on-focus"),
  ).toBeVisible();
  await waitSynced(page);
  await expect
    .poll(
      () =>
        serverFiles("dev").some(
          (f) => f.includes("SUMMARY:Drag me to Focus") && /X-HAKEN-FOCUS:\d{8}/.test(f),
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  await target.click();
  await expect(page.locator(".task-row .title", { hasText: "Drag me to Focus" })).toBeVisible();
});

test("adding in Planned names the target list and takes the date at submit time", async ({
  page,
}) => {
  const start = new Date("2026-11-04T23:59:00").getTime();
  await page.clock.install({ time: start });
  await setupLocal(page);
  await page.getByRole("link", { name: /^Planned/ }).click();
  const add = page.getByPlaceholder(/^Add to /);
  await expect(add).toBeVisible();
  // Midnight passes while the screen stays open; nothing re-renders it.
  await page.clock.setSystemTime(start + 2 * 60_000);
  await add.fill("After midnight");
  await page.keyboard.press("Enter");
  await page.locator(".task-row .title", { hasText: "After midnight" }).click();
  await expect(page.locator("#due-input")).toHaveValue(ymd(start + DAY));
});

test("Focus: each part has its own manual order, kept after reload", async ({ page }) => {
  await setupLocal(page);
  for (const title of ["One", "Two", "Three"]) {
    await addTask(page, title);
    await page.locator("haken-list .task-row .title", { hasText: title }).click();
    await expect(page.getByLabel("Title")).toHaveValue(title);
    await page.getByRole("button", { name: "Add to Focus" }).click();
    await expect(page.getByRole("button", { name: "Remove from Focus" })).toBeVisible();
  }
  await page.getByRole("link", { name: /^Focus/ }).click();
  // Same day added: tie by UID, so read the order the app shows first.
  await expect.poll(async () => (await focusTitles(page)).length).toBe(3);
  const before = await focusTitles(page);
  expect([...before].sort()).toEqual(["One", "Three", "Two"]);
  const last = before[2] as string;
  const link = page.locator("haken-list .task-title", { hasText: last });
  await link.focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => focusTitles(page)).toEqual([before[0], last, before[1]]);
  await expect(link).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  const expected = [last, before[0], before[1]];
  await expect.poll(() => focusTitles(page)).toEqual(expected);
  await page.reload();
  await expect.poll(() => focusTitles(page)).toEqual(expected);
});

test("Focus: Quick add lists due soon, then important, then by list; adding keeps the dialog open", async ({
  page,
}) => {
  const start = new Date("2026-11-04T09:00:00").getTime();
  await page.clock.install({ time: start });
  await setupLocal(page);
  for (const title of ["Later", "Starred", "Soon"]) await addTask(page, title);
  await setDue(page, "Soon", ymd(start + 3 * DAY));
  await page
    .locator("haken-list .task-row", { hasText: "Starred" })
    .getByRole("button", { name: "Mark as important" })
    .click();

  await page.getByRole("link", { name: /^Focus/ }).click();
  await page.getByRole("button", { name: "Quick add" }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.locator(".part-title")).toHaveText(["Due soon", "Important", /./]);
  await expect(dialog.locator(".quick-add-row .title")).toHaveText(["Soon", "Starred", "Later"]);

  await dialog.getByLabel("Filter").fill("star");
  await page.keyboard.press("Enter");
  await expect(dialog.locator(".quick-add-row .title")).toHaveText(["Starred"]);
  await dialog.getByRole("button", { name: "Add “Starred” to Focus" }).click();
  await expect(dialog.getByText("Nothing left to add.")).toBeVisible();
  await expect(dialog.getByLabel("Filter")).toBeFocused();
  await dialog.getByLabel("Filter").fill("");
  await dialog.getByRole("button", { name: "Add “Soon” to Focus" }).click();
  await expect(dialog.locator(".quick-add-row .title")).toHaveText(["Later"]);
  await expect(dialog.getByRole("button", { name: "Add “Later” to Focus" })).toBeFocused();
  await dialog.getByRole("button", { name: "Close" }).click();

  // Same day added: the order ties by UID.
  await expect.poll(async () => (await focusTitles(page)).sort()).toEqual(["Soon", "Starred"]);
  await expect(page.getByRole("link", { name: /errorlogs/ })).toHaveCount(0);
});
