import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { basicAuth, radicale, setupServer, waitSynced } from "./helpers.js";

// Its own user: reordering lists changes the default list other tests rely on.
const USER = "eve";
const AUTH = basicAuth("eve");

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

/** The sidebar order of the given lists (other tests' lists are left out). */
const listNames = async (page: Page, names: readonly string[]): Promise<string[]> =>
  (await page.locator(".own-lists .list-name").allTextContents()).filter((n) => names.includes(n));

async function newList(page: Page, name: string): Promise<void> {
  await page.getByPlaceholder("New list").fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

test("lists: reorder by keyboard, order and colour shared with the server", async ({
  page,
  request,
}) => {
  await setupServer(page, USER);
  const suffix = Date.now();
  const [a, b] = [`Alpha ${suffix}`, `Beta ${suffix}`];
  await newList(page, a);
  await newList(page, b);
  await waitSynced(page);
  await expect.poll(() => listNames(page, [a, b])).toEqual([a, b]);

  await page.locator(".own-lists .list-row", { hasText: b }).focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => listNames(page, [a, b])).toEqual([b, a]);
  await waitSynced(page);
  await expect
    .poll(() => {
      const [ob, oa] = [b, a].map((n) => Number(serverProps(USER).get(n)?.["ICAL:calendar-order"]));
      return (ob ?? Number.NaN) < (oa ?? Number.NaN);
    })
    .toBe(true);

  // Another client colours a list; haken shows it.
  const href = await page
    .locator(".own-lists .list-item", { hasText: a })
    .getAttribute("data-href");
  const res = await request.fetch(radicale(href ?? ""), {
    method: "PROPPATCH",
    headers: { ...AUTH, "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propertyupdate xmlns:d="DAV:" xmlns:a="http://apple.com/ns/ical/"><d:set><d:prop><a:calendar-color>#C0392BFF</a:calendar-color></d:prop></d:set></d:propertyupdate>',
  });
  expect(res.status()).toBe(207);
  await page.reload();
  await expect(
    page.locator(".own-lists .list-item", { hasText: a }).locator("svg.icon").first(),
  ).toHaveAttribute("color", "#C0392B");
  expect(await listNames(page, [a, b])).toEqual([b, a]);
});
