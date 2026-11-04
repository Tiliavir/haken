import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { addTask, setupServer, waitSynced } from "./helpers.js";

// Sync paths that need a second writer: the test itself plays "another
// CalDAV client" (Basic auth through the gateway, like DAVx⁵ would).
const AUTH = { Authorization: `Basic ${Buffer.from("dev:dev").toString("base64")}` };

async function listHref(request: APIRequestContext, name: string): Promise<string> {
  const res = await request.fetch("/dav/dev/", {
    method: "PROPFIND",
    headers: { ...AUTH, Depth: "1", "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
  });
  expect(res.status()).toBe(207);
  const xml = await res.text();
  for (const m of xml.matchAll(/<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
    const block = m[1] ?? "";
    const href = /<(?:\w+:)?href>([^<]+)</.exec(block)?.[1];
    const display = /<(?:\w+:)?displayname>([^<]*)</.exec(block)?.[1];
    if (href !== undefined && display === name) return href;
  }
  throw new Error(`list ${name} not found`);
}

async function findResource(
  request: APIRequestContext,
  list: string,
  summary: string,
): Promise<{ href: string; etag: string; ics: string }> {
  const res = await request.fetch(list, {
    method: "REPORT",
    headers: { ...AUTH, Depth: "1", "Content-Type": "application/xml" },
    data: `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>`,
  });
  const xml = await res.text();
  for (const m of xml.matchAll(/<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g)) {
    const block = m[1] ?? "";
    const data = /<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\//.exec(block)?.[1] ?? "";
    if (data.includes(`SUMMARY:${summary}`)) {
      const href = /<(?:\w+:)?href>([^<]+)</.exec(block)?.[1] ?? "";
      const etag = (/<(?:\w+:)?getetag>([^<]+)</.exec(block)?.[1] ?? "").replace(/&quot;/g, '"');
      return { href, etag, ics: data.replace(/&#13;/g, "").replace(/\r?\n/g, "\r\n") };
    }
  }
  throw new Error(`task ${summary} not found`);
}

async function syncNow(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
}

test("an unreadable VTODO from another client is shown read-only and logged", async ({
  page,
  request,
}) => {
  await setupServer(page);
  const list = await listHref(request, "Haken");
  const broken = readFileSync("tests/fixtures/vtodo/invalid-priority.ics", "utf8").replace(
    "UID:broken-1",
    "UID:e2e-broken",
  );
  const put = await request.fetch(`${list}e2e-broken.ics`, {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "text/calendar", "If-None-Match": "*" },
    data: broken,
  });
  expect(put.status()).toBe(201);
  await syncNow(page);
  await expect(page.locator(".task-row.invalid")).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: /errorlogs/ })).toBeVisible();
  // haken never writes it back.
  const after = await request.fetch(`${list}e2e-broken.ics`, { headers: AUTH });
  expect((await after.text()).includes("PRIORITY:12")).toBe(true);
});

test("a task deleted on the server while edited locally is re-created", async ({
  page,
  context,
  request,
}) => {
  await setupServer(page);
  await addTask(page, "Recreate me");
  await waitSynced(page);
  const list = await listHref(request, "Haken");
  const res = await findResource(request, list, "Recreate me");
  await context.setOffline(true);
  await page.locator(".task-row .title", { hasText: "Recreate me" }).click();
  await page.getByLabel("Title").fill("Recreated");
  await page.getByLabel("Title").press("Enter");
  const del = await request.fetch(res.href, {
    method: "DELETE",
    headers: { ...AUTH, "If-Match": res.etag },
  });
  expect(del.status()).toBeLessThan(300);
  await context.setOffline(false);
  await syncNow(page);
  await expect
    .poll(async () => (await findResource(request, list, "Recreated").catch(() => null)) !== null, {
      timeout: 15_000,
    })
    .toBe(true);
});

test("a local delete against a newer server change restores the task", async ({
  page,
  context,
  request,
}) => {
  await setupServer(page);
  await addTask(page, "Keep me");
  await waitSynced(page);
  const list = await listHref(request, "Haken");
  const res = await findResource(request, list, "Keep me");
  await context.setOffline(true);
  await page.locator(".task-row .title", { hasText: "Keep me" }).click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await page.locator("dialog").getByRole("button", { name: "Delete" }).click();
  await expect(page.locator(".task-row .title", { hasText: "Keep me" })).toHaveCount(0);
  const changed = res.ics.replace("SUMMARY:Keep me", "SUMMARY:Kept by server");
  const put = await request.fetch(res.href, {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "text/calendar", "If-Match": res.etag },
    data: changed,
  });
  expect(put.status()).toBeLessThan(300);
  await context.setOffline(false);
  await syncNow(page);
  await expect(page.locator(".task-row .title", { hasText: "Kept by server" })).toBeVisible({
    timeout: 15_000,
  });
});

test("unknown properties written by another client survive a haken edit", async ({
  page,
  request,
}) => {
  await setupServer(page);
  const list = await listHref(request, "Haken");
  const foreign = readFileSync("tests/fixtures/vtodo/thunderbird-tzid.ics", "utf8")
    .replace("UID:9f3e1d22-6c4b-4a1e-9b2f-5d6e7f8a9b0c", "UID:e2e-foreign")
    .replace("SUMMARY:Example with time zone", "SUMMARY:Foreign task");
  const put = await request.fetch(`${list}e2e-foreign.ics`, {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "text/calendar", "If-None-Match": "*" },
    data: foreign,
  });
  expect(put.status()).toBe(201);
  await syncNow(page);
  await page.locator(".task-row .title", { hasText: "Foreign task" }).click({ timeout: 15_000 });
  await page.locator(".task-head").getByRole("button", { name: "Mark as important" }).click();
  await expect
    .poll(
      async () => (await findResource(request, list, "Foreign task")).ics.includes("PRIORITY:1"),
      { timeout: 15_000 },
    )
    .toBe(true);
  const ics = (await findResource(request, list, "Foreign task")).ics;
  for (const line of [
    "X-MOZ-GENERATION:3",
    "X-LIC-LOCATION:Europe/Berlin",
    "DUE;TZID=Europe/Berlin:20261110T170000",
    "PERCENT-COMPLETE:40",
  ]) {
    expect(ics, line).toContain(line);
  }
});
