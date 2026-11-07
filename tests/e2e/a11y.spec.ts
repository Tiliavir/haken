import { expect, type Page, test } from "@playwright/test";
import { addTask, guard, setupLocal, titles } from "./helpers.js";

/** The live region next to `<haken-app>` (outside the re-rendered tree). */
const live = (page: Page) => page.locator("haken-app + [aria-live='polite']");

const taskLink = (page: Page, title: string) =>
  page.locator("haken-list .task-row .task-title", { hasText: title });

async function deleteTask(page: Page, title: string): Promise<void> {
  await page.locator(".task-row .title", { hasText: title }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(taskLink(page, title)).toHaveCount(0);
}

test("moves are announced: keyboard and pointer, tasks and lists", async ({ page }) => {
  const problems = guard(page);
  await setupLocal(page);
  await addTask(page, "A");
  await addTask(page, "B");
  await addTask(page, "C");

  await taskLink(page, "C").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => titles(page)).toEqual(["B", "C", "A"]);
  await expect(live(page)).toHaveText("C moved to position 2 of 3");
  // The same move again (back and forth) is announced again.
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => titles(page)).toEqual(["C", "B", "A"]);
  await expect(live(page)).toHaveText("C moved to position 1 of 3");

  const from = await page.locator(".task-row .title", { hasText: "A" }).boundingBox();
  const to = await page.locator(".task-row", { hasText: "C" }).boundingBox();
  if (from === null || to === null) throw new Error("no boxes");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 5, to.y + 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => titles(page)).toEqual(["A", "C", "B"]);
  await expect(live(page)).toHaveText("A moved to position 1 of 3");

  await page.getByPlaceholder("New list").fill("Errands");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Errands" })).toBeVisible();
  const first = page.locator(".own-lists .list-row").first();
  const name = await first.locator(".list-name").textContent();
  await first.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(live(page)).toHaveText(`${name} moved to position 2 of 2`);
  expect(problems).toEqual([]);
});

for (const layout of ["desktop", "mobile"] as const) {
  test(`${layout}: after deleting a task, focus moves to the next task, the previous one, then the add field`, async ({
    page,
  }) => {
    const problems = guard(page);
    await setupLocal(page);
    if (layout === "mobile") {
      // One pane at a time: the task screen hides the list.
      await page.setViewportSize({ width: 390, height: 800 });
      await page.reload();
      await page.locator(".own-lists .list-row").first().click();
    }
    await addTask(page, "A");
    await addTask(page, "B");
    await addTask(page, "C");
    expect(await titles(page)).toEqual(["C", "B", "A"]);

    await deleteTask(page, "B");
    await expect(taskLink(page, "A")).toBeFocused();
    await deleteTask(page, "A");
    await expect(taskLink(page, "C")).toBeFocused();
    await deleteTask(page, "C");
    await expect(page.getByPlaceholder("Add a task")).toBeFocused();
    expect(problems).toEqual([]);
  });
}

test("after deleting a list, focus moves to the next list, the previous one, then the new-list field", async ({
  page,
}) => {
  const problems = guard(page);
  await setupLocal(page);
  const lists = page.locator(".own-lists .list-row");
  for (const name of ["One", "Two"]) {
    await page.getByPlaceholder("New list").fill(name);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name })).toBeVisible();
  }
  const names = await page.locator(".own-lists .list-name").allTextContents();
  const dialog = page.locator("dialog");
  const remove = async (name: string): Promise<void> => {
    await lists.filter({ hasText: name }).click();
    await page.getByRole("button", { name: "Edit list" }).click();
    await dialog.getByRole("button", { name: "Delete list" }).click();
    await dialog.getByRole("textbox").fill(name);
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(lists.filter({ hasText: name })).toHaveCount(0);
  };

  // Delete in sidebar order: each time the next list takes focus, the last one has none after it.
  const [first, second, third] = names;
  if (first === undefined || second === undefined || third === undefined || names.length !== 3)
    throw new Error(`expected three lists, got ${names.join(", ")}`);
  await remove(second);
  await expect(lists.filter({ hasText: third })).toBeFocused();
  await remove(third);
  await expect(lists.filter({ hasText: first })).toBeFocused();
  await remove(first);
  await expect(page.getByPlaceholder("New list")).toBeFocused();
  expect(problems).toEqual([]);
});
