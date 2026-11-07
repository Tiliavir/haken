import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  addTask,
  basicAuth,
  guard,
  radicale,
  setupLocal,
  setupServer,
  waitSynced,
} from "./helpers.js";

// Radicale's max_content_length in E2E (playwright.config.ts). Bodies above it get 413.
const RADICALE_LIMIT = 1_000_000;

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

function vtodos(ics: string): string[] {
  return [...ics.matchAll(/BEGIN:VTODO\r\n[\s\S]*?END:VTODO\r\n/g)].map((m) => m[0]);
}

/** Content lines unfolded, parameters sorted: equal iff the VTODOs are equal (RFC 5545 3.1, 3.2). */
function normalized(vtodo: string): string[] {
  return vtodo
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter((line) => line !== "")
    .map((line) => {
      // The fixtures quote no parameter values, so the first ":" ends name and parameters.
      const colon = line.indexOf(":");
      const [name = "", ...params] = line.slice(0, colon).split(";");
      return [name, ...params.sort()].join(";") + line.slice(colon);
    });
}

async function exportIcs(page: Page): Promise<string> {
  await page.getByRole("link", { name: "Settings" }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export (.ics)" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^haken-\d{4}-\d{2}-\d{2}\.ics$/);
  return readFileSync(await download.path(), "utf8");
}

async function importIcs(page: Page, ics: string): Promise<void> {
  await page.getByRole("link", { name: "Settings" }).click();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "Import", exact: true }).click(),
  ]);
  await chooser.setFiles({ name: "in.ics", mimeType: "text/calendar", buffer: Buffer.from(ics) });
  const dialog = page.locator("dialog");
  await expect(dialog.getByText("1 task will be imported.")).toBeVisible();
  await dialog.getByRole("button", { name: "Import" }).click();
  await expect(page.locator(".toast")).toHaveText("1 task imported.");
}

test(".ics import and export round trip keeps every property", async ({ browser }) => {
  const fixture = readFileSync("tests/fixtures/vtodo/haken-attachment.ics", "utf8");
  const original = vtodos(fixture);
  expect(original).toHaveLength(1);

  const a = await browser.newContext();
  const pa = await a.newPage();
  const problems = guard(pa);
  await setupLocal(pa);
  await importIcs(pa, fixture);
  const first = await exportIcs(pa);
  expect(vtodos(first).map(normalized)).toEqual(original.map(normalized));

  // A second device imports the export: its export is byte-identical.
  const b = await browser.newContext();
  const pb = await b.newPage();
  await setupLocal(pb);
  await importIcs(pb, first);
  await pb.goto("/");
  await expect(
    pb.locator(".task-row .title", { hasText: "Example with attachment" }),
  ).toBeVisible();
  expect(vtodos(await exportIcs(pb))).toEqual(vtodos(first));
  expect(problems).toEqual([]);
  await a.close();
  await b.close();
});

test("attachments: add, download, remove; synced each time", async ({ page }) => {
  const problems = guard(page);
  await setupServer(page);
  await addTask(page, "With file");
  await page.locator(".task-row .title", { hasText: "With file" }).click();
  const content = Buffer.from("haken attachment\r\nline 2\r\n");
  await page
    .locator("#attach-input")
    .setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: content });
  const item = page.locator(".attachment", { hasText: "notes.txt" });
  await expect(item).toBeVisible();
  await waitSynced(page);
  const stored = () => serverFiles("dev").find((f) => f.includes("SUMMARY:With file")) ?? "";
  expect(stored()).toContain("FILENAME=notes.txt");
  expect(stored().replace(/\r\n /g, "")).toContain(content.toString("base64"));

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    item.getByRole("button", { name: "notes.txt", exact: true }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("notes.txt");
  expect(readFileSync(await download.path())).toEqual(content);

  await item.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(item).toHaveCount(0);
  await waitSynced(page);
  expect(stored()).not.toContain("ATTACH");
  expect(problems).toEqual([]);
});

test("a task the server rejects as too large (413) stays local and recovers", async ({ page }) => {
  await setupServer(page);
  await addTask(page, "Too big");
  await waitSynced(page);
  await page.locator(".task-row .title", { hasText: "Too big" }).click();
  // Base64 makes the body about 4/3 of the file: above Radicale's limit, below haken's 5 MB.
  const big = Buffer.alloc(RADICALE_LIMIT, 0x61);
  await page
    .locator("#attach-input")
    .setInputFiles({ name: "big.bin", mimeType: "application/octet-stream", buffer: big });
  await expect(page.getByRole("alert")).toHaveText(
    "The server rejected this task as too large. Remove an attachment; the change stays saved here.",
    { timeout: 15_000 },
  );
  const item = page.locator(".attachment", { hasText: "big.bin" });
  await expect(item).toBeVisible();
  const stored = () => serverFiles("dev").find((f) => f.includes("SUMMARY:Too big")) ?? "";
  expect(stored()).not.toContain("ATTACH");

  await page.reload();
  await expect(item).toBeVisible();
  await item.getByRole("button", { name: "Remove big.bin" }).click();
  await expect(item).toHaveCount(0);
  await waitSynced(page);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(stored()).toContain("SUMMARY:Too big");
  expect(stored()).not.toContain("ATTACH");
});

test("a list deleted here while another client edits one of its tasks keeps that list", async ({
  page,
  context,
  request,
}) => {
  const auth = basicAuth("dev");
  await setupServer(page);
  const name = `Shared list ${Date.now()}`;
  await page.getByRole("textbox", { name: "New list" }).fill(name);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await addTask(page, "Edited elsewhere");
  await waitSynced(page);
  const list = await page
    .locator(".own-lists .list-item", { hasText: name })
    .getAttribute("data-href");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Edit list" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete list" }).click();
  await page.locator("dialog").getByRole("textbox").fill(name);
  await page.locator("dialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".own-lists .list-item", { hasText: name })).toHaveCount(0);

  // Another client changes the task on the server.
  const listing = await request.fetch(radicale(list ?? ""), {
    method: "PROPFIND",
    headers: { ...auth, Depth: "1", "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>',
  });
  const href = [...(await listing.text()).matchAll(/<(?:\w+:)?href>([^<]+\.ics)</g)][0]?.[1];
  expect(href).toBeDefined();
  const current = await request.get(radicale(href ?? ""), { headers: auth });
  const put = await request.put(radicale(href ?? ""), {
    headers: {
      ...auth,
      "Content-Type": "text/calendar; charset=utf-8",
      "If-Match": current.headers()["etag"] ?? "",
    },
    data: (await current.text()).replace(
      "SUMMARY:Edited elsewhere",
      "SUMMARY:Edited elsewhere too",
    ),
  });
  expect(put.status()).toBe(204);

  // Back online: the change wins, the task and its list come back, nothing stays queued.
  await context.setOffline(false);
  await page.locator(".own-lists .list-item", { hasText: name }).click({ timeout: 15_000 });
  await expect(page.locator(".task-row .title", { hasText: "Edited elsewhere too" })).toBeVisible();
  await waitSynced(page);
  expect((await request.get(radicale(href ?? ""), { headers: auth })).status()).toBe(200);
});

test("attachments stop before the whole task outgrows the gateway's 32 MB limit", async ({
  page,
}) => {
  await setupLocal(page);
  await addTask(page, "Heavy");
  await page.locator(".task-row .title", { hasText: "Heavy" }).click();
  // 4.9 MB each: about 6.7 MB as base64, so the fifth file would pass 32 MB.
  const file = Buffer.alloc(4_900_000, 0x62);
  for (let i = 1; i <= 4; i++) {
    await page
      .locator("#attach-input")
      .setInputFiles({ name: `part${i}.bin`, mimeType: "application/octet-stream", buffer: file });
    await expect(page.locator(".attachment", { hasText: `part${i}.bin` })).toBeVisible();
  }
  await page
    .locator("#attach-input")
    .setInputFiles({ name: "part5.bin", mimeType: "application/octet-stream", buffer: file });
  await expect(page.locator(".toast")).toContainText("larger than 32 MB");
  await expect(page.locator(".attachment")).toHaveCount(4);
});
