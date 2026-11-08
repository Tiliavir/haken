import { expect, type Locator, type Page, test } from "@playwright/test";
import { addTask, serverFiles, setupLocal, setupServer, titles, waitSynced } from "./helpers.js";

async function label(page: Page, task: string, name: string): Promise<void> {
  await page.locator("haken-list .task-row .title", { hasText: task }).click();
  await page.getByPlaceholder("Label", { exact: true }).fill(name);
  await page.keyboard.press("Enter");
  await expect(page.locator(".chips .chip", { hasText: name })).toBeVisible();
}

/** Drags `from` onto `to`; call it once the screen is settled (no sync re-render pending). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  if (a === null || b === null) throw new Error("no boxes");
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await expect(to).toHaveClass(/drop-target/);
  await page.mouse.up();
}

function labelLink(page: Page, name: string): Locator {
  return page.locator(".labels").getByRole("link", { name: new RegExp(`^${name}`) });
}

function row(page: Page, title: string): Locator {
  return page.locator("haken-list .task-row .title", { hasText: title });
}

test("labels are views: sidebar, add with label, drop adds or moves, order kept", async ({
  page,
}) => {
  await setupLocal(page);
  await expect(page.locator(".labels")).toHaveCount(0);
  await addTask(page, "Milk");
  await addTask(page, "Report");
  await addTask(page, "Tulips");
  await label(page, "Milk", "Shopping");
  // One list only: nothing to choose, so no List row.
  await expect(page.locator("#list-select")).toHaveCount(0);
  await label(page, "Report", "Work");
  // Labels in use are suggested.
  await expect(page.locator("#label-suggestions option")).toHaveAttribute("value", "Shopping");
  await expect(page.locator(".labels .list-name")).toHaveText(["Shopping", "Work"]);

  // From a list, dropping on a label adds it; the task stays in its list.
  await page.getByRole("link", { name: "Close" }).click();
  await expect(page.locator(".pane-detail")).toHaveCount(0);
  await drag(page, row(page, "Tulips"), labelLink(page, "Shopping"));
  await expect(page.locator(".toast")).toHaveText("Label “Shopping” added.");
  await expect(labelLink(page, "Shopping").locator(".count")).toHaveText("2");
  expect(await titles(page)).toContain("Tulips");

  await labelLink(page, "Shopping").click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Shopping");
  await expect.poll(() => titles(page)).toEqual(["Tulips", "Milk"]);
  // The view's own label is not repeated on its rows.
  await expect(page.locator("haken-list .task-row .chip")).toHaveCount(0);

  // Adding in a label view gives the task that label.
  await page.getByPlaceholder("Add to Shopping").fill("Bread");
  await page.keyboard.press("Enter");
  await expect.poll(() => titles(page)).toEqual(["Bread", "Tulips", "Milk"]);

  // Manual order inside the view, kept after reload.
  await page.locator("haken-list .task-row .task-title", { hasText: "Bread" }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => titles(page)).toEqual(["Tulips", "Bread", "Milk"]);
  await page.reload();
  await expect.poll(() => titles(page)).toEqual(["Tulips", "Bread", "Milk"]);

  // From a label view, dropping on another label moves the task there.
  await drag(page, row(page, "Milk"), labelLink(page, "Work"));
  await expect(page.locator(".toast")).toHaveText("Moved to Work.");
  await expect.poll(() => titles(page)).toEqual(["Tulips", "Bread"]);
  await labelLink(page, "Work").click();
  await expect.poll(async () => (await titles(page)).sort()).toEqual(["Milk", "Report"]);
});

test("label views sync as CATEGORIES", async ({ page }) => {
  await setupServer(page);
  await addTask(page, "Label sync A");
  await label(page, "Label sync A", "Label sync one");
  await labelLink(page, "Label sync one").click();
  await page.getByPlaceholder("Add to Label sync one").fill("Label sync B");
  await page.keyboard.press("Enter");
  await expect(row(page, "Label sync B")).toBeVisible();
  await page.locator(".own-lists .list-row").first().click();
  // Wait for the list screen: the label view's add field would label the task.
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
  await addTask(page, "Label sync C");
  await label(page, "Label sync C", "Label sync two");
  await labelLink(page, "Label sync one").click();
  await expect.poll(() => titles(page)).toEqual(["Label sync B", "Label sync A"]);
  await waitSynced(page);
  await drag(page, row(page, "Label sync A"), labelLink(page, "Label sync two"));
  await expect(page.locator(".toast")).toHaveText("Moved to Label sync two.");
  await waitSynced(page);
  const categories = (summary: string): string =>
    /CATEGORIES:(.*)\r?\n/.exec(
      serverFiles("dev").find((f) => f.includes(`SUMMARY:${summary}\r`)) ?? "",
    )?.[1] ?? "";
  await expect.poll(() => categories("Label sync A"), { timeout: 15_000 }).toBe("Label sync two");
  expect(categories("Label sync B")).toBe("Label sync one");
});
