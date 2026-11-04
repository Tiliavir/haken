import { expect, type Page } from "@playwright/test";

export const ORIGIN = "http://127.0.0.1:8181";

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
  await page.getByPlaceholder("Add a task").fill(title);
  await page.keyboard.press("Enter");
  await expect(page.locator(".task-row .title", { hasText: title })).toBeVisible();
}

/** Waits until nothing is pending. Call it only after the edit's commit is visible in the UI. */
export async function waitSynced(page: Page): Promise<void> {
  await expect(page.locator(".sync-line .status")).toHaveText("Synced", { timeout: 15_000 });
}

export async function titles(page: Page): Promise<string[]> {
  return page.locator("haken-list > .tasks .task-row .title").allInnerTexts();
}
