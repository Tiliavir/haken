import { expect, test } from "@playwright/test";
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

  // Keyboard reorder: move "Third" down twice.
  await page.getByRole("button", { name: "Move “Third”" }).focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect.poll(() => titles(page)).toEqual(["Second", "First", "Third"]);

  await page.locator(".task-row .title", { hasText: "First" }).click();
  await page.getByPlaceholder("Add step").fill("Sub");
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
  const grip = page.getByRole("button", { name: "Move “C”" });
  const target = page.locator(".task-row", { hasText: "A" });
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, to.y + to.height - 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual(["B", "A", "C"]);
});
