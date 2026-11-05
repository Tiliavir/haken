import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { addTask, setupServer, waitSynced } from "./helpers.js";

/** Collection display name → task files in it, as stored by Radicale. */
function collections(user: string): Map<string, string[]> {
  const root = join("e2e-data", "collections", "collection-root", user);
  const out = new Map<string, string[]>();
  for (const dir of readdirSync(root)) {
    const path = join(root, dir);
    if (!statSync(path).isDirectory()) continue;
    const props = join(path, ".Radicale.props");
    const name = statSync(props, { throwIfNoEntry: false })
      ? ((JSON.parse(readFileSync(props, "utf8")) as Record<string, string>)["D:displayname"] ??
        dir)
      : dir;
    out.set(
      name,
      readdirSync(path)
        .filter((f) => f.endsWith(".ics"))
        .map((f) => readFileSync(join(path, f), "utf8")),
    );
  }
  return out;
}

test("move a task with its checklist to another list; the server has it once, in the new list", async ({
  page,
}) => {
  await setupServer(page);
  await page.getByPlaceholder("New list").fill("Other");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Other" })).toBeVisible();
  await page.getByRole("link", { name: /^Haken/ }).click();
  await addTask(page, "Travelling task");
  await page.locator("haken-list .task-row .title", { hasText: "Travelling task" }).click();
  await page.getByPlaceholder(/Add (step|item)/).fill("Packed item");
  await page.keyboard.press("Enter");
  await expect(page.locator(".step-title")).toHaveValue("Packed item");
  await waitSynced(page);

  await page
    .locator("haken-list .task-row .title", { hasText: "Travelling task" })
    .click({ button: "right" });
  await page.getByRole("button", { name: "Other" }).click();
  await expect(page.locator(".toast")).toHaveText("Moved to Other.");
  await expect(page.locator("haken-list .task-row", { hasText: "Travelling task" })).toHaveCount(0);
  await waitSynced(page);

  await expect
    .poll(
      () => {
        const c = collections("dev");
        const other = c.get("Other") ?? [];
        const haken = c.get("Haken") ?? [];
        return [
          other.some((f) => f.includes("SUMMARY:Travelling task")),
          other.some((f) => f.includes("SUMMARY:Packed item")),
          haken.some((f) => f.includes("Travelling task") || f.includes("Packed item")),
        ];
      },
      { timeout: 15_000 },
    )
    .toEqual([true, true, false]);

  await page.getByRole("link", { name: /^Other/ }).click();
  await page.locator("haken-list .task-row .title", { hasText: "Travelling task" }).click();
  await expect(page.locator(".step-title")).toHaveValue("Packed item");
  await expect(page.locator("#list-select")).toHaveValue(/\/$/);
});
