import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ROOT } from "./helpers.js";

test("vendored ical.js matches the recorded checksum", () => {
  const dir = join(ROOT, "web", "vendor", "ical.js");
  const readme = readFileSync(join(dir, "README.md"), "utf8");
  const recorded = /SHA-256 of `ical\.js` \| `([0-9a-f]{64})`/.exec(readme)?.[1];
  assert.ok(recorded, "checksum row missing in README");
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(dir, "ical.js")))
      .digest("hex"),
    recorded,
  );
});
