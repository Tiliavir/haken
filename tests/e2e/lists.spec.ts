import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { setupServer, waitSynced } from "./helpers.js";

const AUTH = { Authorization: `Basic ${Buffer.from("dev:dev").toString("base64")}` };

/** Display name → Radicale's stored collection properties. */
function serverProps(user: string): Map<string, Record<string, string>> {
  const root = join("e2e-data", "collections", "collection-root", user);
  const out = new Map<string, Record<string, string>>();
  for (const dir of readdirSync(root)) {
    const props = join(root, dir, ".Radicale.props");
    if (!statSync(props, { throwIfNoEntry: false })) continue;
    const p = JSON.parse(readFileSync(props, "utf8")) as Record<string, string>;
    out.set(p["D:displayname"] ?? dir, p);
  }
  return out;
}

const listNames = (page: Page): Promise<string[]> =>
  page.locator(".own-lists .list-name").allTextContents();

async function newList(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder("New list").fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("lists: reorder by keyboard, order and colour shared with the server", async ({
  page,
  request,
}) => {
  await setupServer(page);
  await newList(page, "Alpha");
  await newList(page, "Beta");
  await waitSynced(page);
  await expect.poll(() => listNames(page)).toEqual(["Alpha", "Beta", "Haken"]);

  await page.getByRole("button", { name: "Move “Haken”" }).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await expect.poll(() => listNames(page)).toEqual(["Haken", "Alpha", "Beta"]);
  await waitSynced(page);
  await expect
    .poll(() =>
      ["Haken", "Alpha", "Beta"].map((n) => serverProps("dev").get(n)?.["ICAL:calendar-order"]),
    )
    .toEqual(["1", "2", "3"]);

  // Another client colours a list; haken shows it.
  const href = await page
    .locator(".own-lists .list-item", { hasText: "Alpha" })
    .getAttribute("data-href");
  const res = await request.fetch(href ?? "", {
    method: "PROPPATCH",
    headers: { ...AUTH, "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop><a:calendar-color>#C0392BFF</a:calendar-color></d:prop></d:set></d:propertyupdate>',
  });
  expect(res.status()).toBe(207);
  await page.reload();
  await expect(
    page.locator(".own-lists .list-item", { hasText: "Alpha" }).locator("svg.icon").first(),
  ).toHaveAttribute("color", "#C0392B");
  expect(await listNames(page)).toEqual(["Haken", "Alpha", "Beta"]);
});
