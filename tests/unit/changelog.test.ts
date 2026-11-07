import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, parseChangelog, unseen } from "../../web/src/app/changelog.js";
import { InvalidInputError } from "../../web/src/domain/errors.js";

const entry = (version: string) => ({
  version,
  date: "2026-11-07",
  summary: `Summary ${version}`,
  sections: [{ title: "Added", items: [`Item ${version}`] }],
});
const entries = parseChangelog([entry("0.10.0"), entry("0.3.0"), entry("0.2.0"), entry("0.1.0")]);
const versions = (seen: string | null, current: string) =>
  unseen(entries, seen, current).map((e) => e.version);

test("compares versions numerically", () => {
  assert.ok(compareVersions("0.10.0", "0.9.0") > 0);
  assert.ok(compareVersions("1.0.0", "0.99.99") > 0);
  assert.equal(compareVersions("0.3.0", "0.3.0"), 0);
});

test("unseen: versions after the seen one up to the current one, newest first", () => {
  assert.deepEqual(versions("0.1.0", "0.3.0"), ["0.3.0", "0.2.0"]);
  assert.deepEqual(versions("0.2.0", "0.10.0"), ["0.10.0", "0.3.0"]);
  assert.deepEqual(versions("0.3.0", "0.3.0"), []);
  // Unknown (installed before haken remembered it): only the current version.
  assert.deepEqual(versions(null, "0.3.0"), ["0.3.0"]);
  // Downgrade: nothing newer to show.
  assert.deepEqual(versions("0.10.0", "0.3.0"), []);
});

test("unseen: the current version must be in the changelog", () => {
  assert.throws(() => unseen(entries, "0.1.0", "0.4.0"), InvalidInputError);
});

test("parseChangelog rejects unexpected shapes", () => {
  const bad: unknown[] = [
    {},
    [null],
    [{ ...entry("0.1.0"), version: "v0.1.0" }],
    [{ ...entry("0.1.0"), date: "7.11.2026" }],
    [{ ...entry("0.1.0"), summary: 1 }],
    [{ ...entry("0.1.0"), sections: {} }],
    [{ ...entry("0.1.0"), sections: [{ title: "", items: [] }] }],
    [{ ...entry("0.1.0"), sections: [{ title: "Added", items: [""] }] }],
  ];
  for (const value of bad) assert.throws(() => parseChangelog(value), InvalidInputError);
});
