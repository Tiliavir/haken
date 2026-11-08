import { readFileSync } from "node:fs";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { addTask, basicAuth, firstList, radicale, setupServer, waitSynced } from "./helpers.js";

const AUTH = basicAuth("dev");

/** All task resources of the user's lists, as written on the server. */
async function serverTasks(request: APIRequestContext): Promise<string[]> {
  const home = await request.fetch(radicale("/dev/"), {
    method: "PROPFIND",
    headers: { ...AUTH, Depth: "1", "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>',
  });
  const hrefs = [...(await home.text()).matchAll(/<(?:\w+:)?href>([^<]+)</g)].map(
    (m) => m[1] as string,
  );
  const out: string[] = [];
  for (const href of hrefs.filter((h) => h !== "/dev/")) {
    const res = await request.fetch(radicale(href), {
      method: "REPORT",
      headers: { ...AUTH, Depth: "1", "Content-Type": "application/xml" },
      data: '<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>',
    });
    if (res.status() !== 207) continue;
    for (const m of (await res.text()).matchAll(/<(?:\w+:)?calendar-data[^>]*>([\s\S]*?)<\//g)) {
      out.push((m[1] ?? "").replace(/&#13;/g, "").replace(/\r?\n[ \t]/g, ""));
    }
  }
  return out;
}

async function serverTask(request: APIRequestContext, summary: string): Promise<string> {
  const found = (await serverTasks(request)).find((t) => t.includes(`SUMMARY:${summary}`));
  if (found === undefined) throw new Error(`${summary} not on server`);
  return found;
}

function localDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

test("a weekly task advances on completion, reopens its steps and syncs", async ({
  page,
  request,
}) => {
  await setupServer(page);
  await addTask(page, "Weekly chore");
  await page.locator(".task-row .title", { hasText: "Weekly chore" }).click();
  await page.getByPlaceholder("Add item").fill("Part one");
  await page.keyboard.press("Enter");
  await page.getByLabel("Repeat").selectOption("weekly");
  await expect(
    page.locator(".task-row", { hasText: "Weekly chore" }).locator(".meta"),
  ).toContainText("Weekly");
  await page.locator(".step").getByRole("button", { name: "Mark as completed" }).click();
  await expect(page.locator(".step .check.done")).toHaveCount(1);

  await page.locator(".task-head").getByRole("button", { name: "Mark as completed" }).click();
  await expect(page.locator(".toast")).toContainText("Weekly chore");
  await expect(page.locator(".step .check.done")).toHaveCount(0);
  await expect(page.locator(".task-row", { hasText: "Weekly chore" })).toHaveCount(1);
  await expect(page.locator(".completed")).toHaveCount(0);
  await waitSynced(page);

  await expect
    .poll(
      async () =>
        (await serverTask(request, "Weekly chore").catch(() => "")).includes(
          `DUE;VALUE=DATE:${localDate(7)}`,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  const ics = await serverTask(request, "Weekly chore");
  expect(ics).toContain("RRULE:FREQ=WEEKLY");
  expect(ics).toContain(`DTSTART;VALUE=DATE:${localDate(7)}`);
  expect(ics).toContain("STATUS:NEEDS-ACTION");
  expect(ics).not.toContain("STATUS:COMPLETED");
});

test("a recurring task from Tasks.org is advanced and keeps its own properties", async ({
  page,
  request,
}) => {
  await setupServer(page);
  const list = await firstList(request);
  const foreign = readFileSync("tests/fixtures/vtodo/tasksorg-recurring.ics", "utf8")
    .replace("UID:4d2c1b0a-9f8e-4d7c-8b6a-5f4e3d2c1b0a", "UID:e2e-tasksorg-recurring")
    .replace("SUMMARY:Example every two weeks", "SUMMARY:Fortnightly");
  const put = await request.fetch(radicale(`${list}e2e-tasksorg-recurring.ics`), {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "text/calendar", "If-None-Match": "*" },
    data: foreign,
  });
  expect(put.status()).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const row = page.locator(".task-row", { hasText: "Fortnightly" });
  await expect(row.locator(".meta")).toContainText("Every 2 weeks", { timeout: 15_000 });
  await row.getByRole("button", { name: "Mark as completed" }).click();
  await expect
    .poll(
      async () => (await serverTask(request, "Fortnightly")).includes("DUE;VALUE=DATE:20261116"),
      { timeout: 15_000 },
    )
    .toBe(true);
  const ics = await serverTask(request, "Fortnightly");
  for (const line of [
    "DTSTART;VALUE=DATE:20261116",
    "RRULE:FREQ=WEEKLY;INTERVAL=2",
    "X-TASKS-ORG-READ-ONLY:FALSE",
    "X-APPLE-SORT-ORDER:814000000",
  ]) {
    expect(ics, line).toContain(line);
  }
});

test("a rule haken cannot edit is shown read-only and never written", async ({ page, request }) => {
  await setupServer(page);
  const list = await firstList(request);
  const count = readFileSync("tests/fixtures/vtodo/recurring-bymonthday.ics", "utf8").replace(
    "SUMMARY:Twice a month",
    "SUMMARY:Five times e2e",
  );
  const put = await request.fetch(radicale(`${list}e2e-count.ics`), {
    method: "PUT",
    headers: { ...AUTH, "Content-Type": "text/calendar", "If-None-Match": "*" },
    data: count.replace("UID:bymonthday-1", "UID:e2e-count"),
  });
  expect(put.status()).toBe(201);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  const row = page.locator(".task-row", { hasText: "Five times e2e" });
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByRole("button", { name: "Mark as completed" })).toBeDisabled();
  await row.locator(".title").click();
  await expect(page.getByText("repeats in a way Haken cannot edit")).toBeVisible();
  await expect(page.getByLabel("Repeat")).toHaveCount(0);
});

test("a task that ends after two times completes for good on the second", async ({
  page,
  request,
}) => {
  await setupServer(page);
  await addTask(page, "Twice only");
  await page.locator(".task-row .title", { hasText: "Twice only" }).click();
  await page.getByLabel("Repeat").selectOption("daily");
  await page.getByLabel("Ends").selectOption("count");
  await page.getByLabel("times", { exact: true }).fill("2");
  await page.getByLabel("times", { exact: true }).press("Enter");
  const row = page.locator(".task-row", { hasText: "Twice only" });
  await expect(row.locator(".meta")).toContainText("2 times left");
  await waitSynced(page);
  await expect
    .poll(async () => (await serverTask(request, "Twice only").catch(() => "")).includes("COUNT=2"))
    .toBe(true);

  await row.getByRole("button", { name: "Mark as completed" }).click();
  await expect(row.locator(".meta")).toContainText("1 time left");
  await row.getByRole("button", { name: "Mark as completed" }).click();
  await expect(page.locator(".completed")).toHaveCount(1);
  await waitSynced(page);
  await expect
    .poll(
      async () =>
        (await serverTask(request, "Twice only").catch(() => "")).includes("STATUS:COMPLETED"),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(await serverTask(request, "Twice only")).toContain("RRULE:FREQ=DAILY;COUNT=1");
});

test("a due time is written floating, shown in the meta line, and DTSTART follows", async ({
  page,
  request,
}) => {
  await setupServer(page);
  await addTask(page, "Timed chore");
  await page.locator(".task-row .title", { hasText: "Timed chore" }).click();
  await expect(page.locator("#due-time-input")).toHaveCount(0);
  const tomorrow = localDate(1);
  await page
    .locator("#due-input")
    .fill(`${tomorrow.slice(0, 4)}-${tomorrow.slice(4, 6)}-${tomorrow.slice(6, 8)}`);
  await page.getByLabel("Repeat").selectOption("weekly");
  await page.locator("#due-time-input").fill("09:30");
  const meta = page.locator(".task-row", { hasText: "Timed chore" }).locator(".meta");
  await expect(meta).toContainText(/Tomorrow, 0?9:30/);
  await waitSynced(page);
  await expect
    .poll(
      async () =>
        (await serverTask(request, "Timed chore").catch(() => "")).includes(
          `DUE:${tomorrow}T093000`,
        ),
      {
        timeout: 15_000,
      },
    )
    .toBe(true);
  expect(await serverTask(request, "Timed chore")).toContain(`DTSTART:${tomorrow}T093000`);

  await page.getByRole("button", { name: "Remove time" }).click();
  await expect(meta).not.toContainText("9:30");
  await expect
    .poll(
      async () => (await serverTask(request, "Timed chore")).includes(`DUE;VALUE=DATE:${tomorrow}`),
      { timeout: 15_000 },
    )
    .toBe(true);
  expect(await serverTask(request, "Timed chore")).toContain(`DTSTART;VALUE=DATE:${tomorrow}`);
});
