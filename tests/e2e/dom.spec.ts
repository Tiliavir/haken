import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { addTask, guard, setupLocal, setupServer, waitSynced } from "./helpers.js";

// Rendered DOM validity: every screen's DOM is checked with the W3C validator,
// and every control in Chrome's accessibility tree must have a name.
const OUT = join("test-results", "dom");

/** Roles a screen reader user operates; each needs an accessible name. */
const CONTROLS = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "listbox",
  "menuitem",
  "tab",
]);

interface AxNode {
  readonly ignored: boolean;
  readonly role?: { readonly value?: unknown };
  readonly name?: { readonly value?: unknown };
  readonly backendDOMNodeId?: number;
}

/** Controls without an accessible name, as `role: outerHTML` (Chrome's computed tree). */
async function unnamed(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  const { nodes } = (await cdp.send("Accessibility.getFullAXTree")) as { nodes: AxNode[] };
  const out: string[] = [];
  for (const n of nodes) {
    const role = String(n.role?.value ?? "");
    if (n.ignored || !CONTROLS.has(role) || String(n.name?.value ?? "").trim() !== "") continue;
    if (n.backendDOMNodeId === undefined) throw new Error(`${role} without a DOM node`);
    const { object } = await cdp.send("DOM.resolveNode", { backendNodeId: n.backendDOMNodeId });
    if (object.objectId === undefined) throw new Error(`${role} node not resolvable`);
    const html = await cdp.send("Runtime.callFunctionOn", {
      objectId: object.objectId,
      functionDeclaration: "function () { return this.outerHTML.slice(0, 200); }",
      returnByValue: true,
    });
    out.push(`${role}: ${String(html.result.value)}`);
  }
  await cdp.detach();
  return out;
}

const nameless: string[] = [];

async function snapshot(page: Page, name: string): Promise<string> {
  nameless.push(...(await unnamed(page)).map((u) => `${name}: ${u}`));
  mkdirSync(OUT, { recursive: true });
  const html = await page.evaluate(() => `<!DOCTYPE html>\n${document.documentElement.outerHTML}`);
  const file = join(OUT, `${name}.html`);
  writeFileSync(file, html);
  return file;
}

test("every screen renders valid HTML and names every control", async ({ page }) => {
  const files: string[] = [];
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  files.push(await snapshot(page, "welcome"));
  await setupLocal(page);
  await addTask(page, "Validate me");
  files.push(await snapshot(page, "list"));
  await page.locator(".task-row .title", { hasText: "Validate me" }).click();
  await page.getByPlaceholder("Add item").fill("Step");
  await page.keyboard.press("Enter");
  await page.getByRole("textbox", { name: "Label" }).fill("tag");
  await page.keyboard.press("Enter");
  await expect(page.locator(".chip", { hasText: "tag" }).first()).toBeVisible();
  files.push(await snapshot(page, "task"));
  await page.getByLabel("Repeat").selectOption("custom");
  await expect(page.locator(".repeat-custom")).toBeVisible();
  await page.locator(".weekday", { hasText: "Mon" }).click();
  await expect(page.locator(".weekday input:checked")).toHaveCount(1);
  files.push(await snapshot(page, "task-repeat"));
  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  files.push(await snapshot(page, "settings"));
  expect(nameless).toEqual([]);
  try {
    execFileSync(
      "java",
      [
        "-jar",
        "node_modules/vnu-jar/build/dist/vnu.jar",
        "--errors-only",
        "--filterpattern",
        ".*Content Security Policy.*",
        ...files,
      ],
      { stdio: "pipe" },
    );
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    throw new Error(`vnu found errors in the rendered DOM:\n${stderr}`);
  }
});

test("Trusted Types are enforced: HTML strings cannot reach the DOM", async ({ page }) => {
  const problems = guard(page);
  await setupServer(page);
  await waitSynced(page);
  const refused = await page.evaluate(() => {
    try {
      document.body.insertAdjacentHTML("beforeend", "<b>x</b>");
      return false;
    } catch (e) {
      return e instanceof TypeError;
    }
  });
  expect(refused).toBe(true);
  expect(problems.filter((p) => !p.includes("TrustedHTML"))).toEqual([]);
});
