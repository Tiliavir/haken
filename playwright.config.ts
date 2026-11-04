import { defineConfig } from "@playwright/test";

// E2E against the real gateway and a real Radicale (tools/dev-run.sh).
// Locally the installed Chrome is used; CI runs the official Playwright image.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:8181",
    channel: process.env["PLAYWRIGHT_CHANNEL"] ?? "chrome",
    viewport: { width: 1200, height: 800 },
  },
  webServer: {
    command:
      "rm -rf e2e-data && HAKEN_DEV_DATA=e2e-data RADICALE_PORT=5242 PORT=8181 tools/dev-run.sh",
    url: "http://127.0.0.1:8181/",
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
