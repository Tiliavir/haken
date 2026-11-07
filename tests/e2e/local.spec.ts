import { expect, type Page, test } from "@playwright/test";
import { addTask, guard, setupLocal, titles } from "./helpers.js";

test("local account: add, step, complete, reorder by keyboard, survives reload", async ({
  page,
}) => {
  const problems = guard(page);
  await setupLocal(page);
  await addTask(page, "First");
  await addTask(page, "Second");
  await addTask(page, "Third");
  expect(await titles(page)).toEqual(["Third", "Second", "First"]);

  // Keyboard reorder: move "Third" down twice; focus stays on it.
  const third = page.locator(".task-row .task-title", { hasText: "Third" });
  await third.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => titles(page)).toEqual(["Second", "Third", "First"]);
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => titles(page)).toEqual(["Second", "First", "Third"]);
  await expect(third).toBeFocused();

  await page.locator(".task-row .title", { hasText: "First" }).click();
  await page.getByPlaceholder("Add item").fill("Sub");
  await page.keyboard.press("Enter");
  await expect(page.locator(".step-title")).toHaveValue("Sub");

  await page
    .locator(".task-row", { hasText: "Second" })
    .getByRole("button", { name: "Mark as completed" })
    .click();
  await expect(page.locator(".completed summary")).toHaveText("Completed · 1");

  await page.reload();
  await expect.poll(() => titles(page)).toEqual(["First", "Third"]);
  expect(problems).toEqual([]);
});

test("pointer drag reorders", async ({ page }) => {
  await setupLocal(page);
  await addTask(page, "A");
  await addTask(page, "B");
  await addTask(page, "C");
  const row = page.locator(".task-row .title", { hasText: "C" });
  const target = page.locator(".task-row", { hasText: "A" });
  const from = await row.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, to.y + to.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual(["B", "A", "C"]);
  // Dropping is not a click: the task did not open.
  await expect(page.getByLabel("Title")).toHaveCount(0);
});

/**
 * A real touch gesture (Chromium input pipeline): down on `selector`, move by
 * `dy`, up. With `hold`, it moves only once the row is lifted (`.dragging`).
 */
async function touchDrag(page: Page, selector: string, hold: boolean, dy: number): Promise<void> {
  const box = await page.locator(selector).boundingBox();
  if (box === null) throw new Error("no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", at: number | null) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: at === null ? [] : [{ x, y: at }],
    });
  await touch("touchStart", y);
  if (hold) await expect(page.locator(".task-row.dragging")).toBeVisible();
  for (let i = 1; i <= 8; i++) await touch("touchMove", y + (dy * i) / 8);
  await touch("touchEnd", null);
  await cdp.detach();
}

test("touch: hold lifts the row, a quick swipe does not reorder", async ({ page }) => {
  await setupLocal(page);
  await addTask(page, "A");
  await addTask(page, "B");
  await addTask(page, "C");
  const rowHeight = (await page.locator(".task-row").first().boundingBox())?.height ?? 0;
  expect(await titles(page)).toEqual(["C", "B", "A"]);
  const a = '.task-row:has(.title:text-is("A")) .title';
  await touchDrag(page, a, false, -2 * rowHeight);
  await expect.poll(() => titles(page)).toEqual(["C", "B", "A"]);
  await touchDrag(page, a, true, -1.4 * rowHeight);
  await expect.poll(() => titles(page)).toEqual(["C", "A", "B"]);
});

test("note and title save while typing, without a blur", async ({ page, context }) => {
  const problems = guard(page);
  await setupLocal(page);
  await addTask(page, "Autosave");
  await page.locator(".task-row .title", { hasText: "Autosave" }).click();
  // A second tab on the same task shows when the edit is stored.
  const other = await context.newPage();
  await other.goto(page.url());
  await page.getByLabel("Title").pressSequentially(" now");
  await page.getByLabel("Note").pressSequentially("typed, never blurred");
  await expect(page.getByLabel("Note")).toBeFocused();
  await expect(other.getByLabel("Note")).toHaveValue("typed, never blurred");
  await expect(other.getByLabel("Title")).toHaveValue("Autosave now");
  await page.reload();
  await expect(page.getByLabel("Note")).toHaveValue("typed, never blurred");
  await expect(page.getByLabel("Title")).toHaveValue("Autosave now");
  expect(problems).toEqual([]);
});

test("warns when the device storage is nearly full", async ({ page }) => {
  await setupLocal(page);
  await page.addInitScript(() => {
    navigator.storage.estimate = async () => ({ usage: 90, quota: 100 });
  });
  await page.reload();
  await expect(page.locator(".toast")).toContainText("90 % full");
});

/**
 * Fires the paste event of Ctrl+V with `text` on `field`; true if the app took
 * the paste over (a synthetic event inserts nothing by itself).
 */
function stepTitles(page: Page): Promise<string[]> {
  return page
    .locator(".step-title")
    .evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
}

function paste(field: ReturnType<Page["getByPlaceholder"]>, text: string): Promise<boolean> {
  return field.evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    return !el.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

test("pasting several lines adds one task or step per line, in order", async ({ page }) => {
  const problems = guard(page);
  await setupLocal(page);
  await addTask(page, "Existing");

  const field = page.getByPlaceholder("Add a task");
  await field.fill("Buy ");
  expect(await paste(field, "milk\r\n\r\n  eggs  \nbread\n")).toBe(true);
  await expect.poll(() => titles(page)).toEqual(["Buy milk", "eggs", "bread", "Existing"]);
  await expect(field).toHaveValue("");

  // A single line stays a normal paste.
  expect(await paste(field, "Just one\n")).toBe(false);

  await page.locator(".task-row .title", { hasText: "Existing" }).click();
  const step = page.getByPlaceholder("Add item");
  await step.fill("Sub");
  await page.keyboard.press("Enter");
  await expect.poll(() => stepTitles(page)).toEqual(["Sub"]);
  expect(await paste(step, "One\nTwo\nThree")).toBe(true);
  await expect.poll(() => stepTitles(page)).toEqual(["Sub", "One", "Two", "Three"]);
  await expect(step).toHaveValue("");

  await page.reload();
  await expect.poll(() => stepTitles(page)).toEqual(["Sub", "One", "Two", "Three"]);
  expect(problems).toEqual([]);
});
