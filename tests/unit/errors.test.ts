import assert from "node:assert/strict";
import { test } from "node:test";
import { buildReport } from "../../web/src/app/errors.js";
import { HakenError } from "../../web/src/domain/errors.js";

test("error report drops credential keys and keeps task values", () => {
  const error = new HakenError("sync", "Unexpected status", {
    password: "p",
    Authorization: "Basic x",
    cookie: "c",
    sessionId: "s",
    syncToken: "t",
    secret: "x",
    summary: "Buy milk",
    uid: "u1",
  });
  const report = buildReport(error, "sync.push", { online: true });
  assert.deepEqual(report.details, [
    "Operation: sync.push",
    "summary: Buy milk",
    "uid: u1",
    "online: true",
  ]);
  assert.equal(report.layer, "sync");
});

test("error report strips query strings and fragments from every text", () => {
  const cause = new Error("GET https://h.example/dav/x?a=1 failed");
  const error = new HakenError(
    "net",
    "Failed https://h.example/a?b=c#d",
    { path: "https://h.example/p?q=1", paths: ["https://h.example/r#s"] },
    { cause },
  );
  error.stack = "HakenError: x\n    at f (https://h.example/app.js?v=2:1:2)";
  const report = buildReport(error, "op", {});
  const all = [report.message, report.stack, ...report.details].join("\n");
  assert.doesNotMatch(all, /[?#]/);
  assert.match(all, /path: https:\/\/h\.example\/p$/m);
  assert.match(all, /Cause: Error: GET https:\/\/h\.example\/dav\/x failed/);
});

test("non-errors are reported as such", () => {
  const report = buildReport("boom", "op", {});
  assert.equal(report.name, "Error");
  assert.equal(report.message, "Non-error thrown: string");
  assert.equal(report.layer, "app");
});
