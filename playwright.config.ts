import { defineConfig } from "@playwright/test";

// E2E against the real gateway and a real Radicale (tools/dev-run.sh).
// Locally the installed Chrome is used; CI runs the official Playwright image.
// E2E_PORT moves the gateway (Radicale: E2E_PORT + 10), for parallel local runs.
// Radicale accepts bodies up to 1 MB, so tests/e2e/data.spec.ts can provoke a 413.
const port = Number(process.env["E2E_PORT"] ?? "8181");

export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    channel: process.env["PLAYWRIGHT_CHANNEL"] ?? "chrome",
    viewport: { width: 1200, height: 800 },
  },
  webServer: {
    command: `rm -rf e2e-data && HAKEN_DEV_DATA=e2e-data RADICALE_PORT=${port + 10} RADICALE_MAX_CONTENT_LENGTH=1000000 PORT=${port} tools/dev-run.sh`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
