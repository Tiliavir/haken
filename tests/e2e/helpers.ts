import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { type APIRequestContext, expect, type Page } from "@playwright/test";

const PORT = Number(process.env["E2E_PORT"] ?? "8181");
export const ORIGIN = `http://127.0.0.1:${PORT}`;

/** Radicale itself, as other CalDAV clients reach it (playwright.config.ts: E2E_PORT + 10). */
const RADICALE = `http://127.0.0.1:${PORT + 10}`;

/** Basic auth for Radicale, as another CalDAV client sends it. */
export function basicAuth(user: string): { Authorization: string } {
  const credentials = Buffer.from(`${user}:${user}`).toString("base64");
  return { Authorization: `Basic ${credentials}` };
}

/** Radicale URL of a gateway href (`/dav/<user>/…`, as the app shows it) or a Radicale href (`/<user>/…`). */
export function radicale(href: string): string {
  const path = href.startsWith("/dav/") ? href.slice("/dav".length) : href;
  if (!path.startsWith("/") || path.startsWith("/dav/"))
    throw new Error(`not a CalDAV path: ${href}`);
  return RADICALE + path;
}

/** Fails the test on any request to another origin or any page error. */
export function guard(page: Page): string[] {
  const problems: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!url.startsWith(`${ORIGIN}/`) && !url.startsWith("blob:") && !url.startsWith("data:"))
      problems.push(`foreign request: ${url}`);
  });
  page.on("pageerror", (e) => problems.push(`page error: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console error: ${m.text()}`);
  });
  return problems;
}

export async function button(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("button", { name }).first().click();
}

export async function setupServer(page: Page, user = "dev", password = user): Promise<void> {
  await page.goto("/");
  await button(page, "Start");
  await button(page, "Skip");
  await button(page, /Sync with my server/);
  await page.getByLabel("User name").fill(user);
  await page.getByLabel("Password").fill(password);
  await button(page, "Sign in");
  await expect(page.getByRole("heading", { name: "Install Haken" })).toBeVisible({
    timeout: 15_000,
  });
  await button(page, "Later");
  await button(page, "Later");
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
}

export async function setupLocal(page: Page): Promise<void> {
  await page.goto("/");
  await button(page, "Start");
  await button(page, "Skip");
  await button(page, /Only on this device/);
  await button(page, "Start empty");
  await button(page, "Later");
  await button(page, "Later");
  await expect(page.getByPlaceholder("Add a task")).toBeVisible();
}

export async function addTask(page: Page, title: string): Promise<void> {
  await page.getByPlaceholder(/^Add (a task|to )/).fill(title);
  await page.keyboard.press("Enter");
  await expect(page.locator(".task-row .title", { hasText: title })).toBeVisible();
}

/** Waits until nothing is pending. Call it only after the edit's commit is visible in the UI. */
export async function waitSynced(page: Page): Promise<void> {
  await expect(page.locator(".sync-line .status")).toHaveText("Synced", { timeout: 15_000 });
}

export function titles(page: Page): Promise<string[]> {
  return page.locator("haken-list > .tasks .task-row .title").allInnerTexts();
}

/** The `.ics` files of a user in Radicale's storage (E2E data dir). */
export function serverFiles(user: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith(".Radicale")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".ics")) out.push(readFileSync(p, "utf8"));
    }
  };
  walk(join("e2e-data", "collections", "collection-root", user));
  return out;
}

/** Radicale href of the user's list *Haken* (created at setup). */
export async function firstList(request: APIRequestContext, user = "dev"): Promise<string> {
  const res = await request.fetch(radicale(`/${user}/`), {
    method: "PROPFIND",
    headers: { ...basicAuth(user), Depth: "1", "Content-Type": "application/xml" },
    data: '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/></d:prop></d:propfind>',
  });
  for (const m of (await res.text()).matchAll(
    /<(?:\w+:)?response>([\s\S]*?)<\/(?:\w+:)?response>/g,
  )) {
    const block = m[1] ?? "";
    if (/<(?:\w+:)?displayname>Haken</.test(block))
      return /<(?:\w+:)?href>([^<]+)</.exec(block)?.[1] ?? "";
  }
  throw new Error("list Haken not found");
}
