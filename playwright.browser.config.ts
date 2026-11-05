import { defineConfig } from "@playwright/test";

// Browser unit tests: built modules from dist/web against an in-process CalDAV
// stub (tests/browser/caldav-stub.ts). No gateway, no Radicale, no port.
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: { channel: process.env["PLAYWRIGHT_CHANNEL"] ?? "chrome" },
});
