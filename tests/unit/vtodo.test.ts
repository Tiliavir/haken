import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InvalidInputError } from "../../web/src/domain/errors.js";
import {
  APPLE_EPOCH_SECONDS,
  applyEdit,
  attachmentData,
  createTask,
  parseResource,
  readTask,
  serialize,
} from "../../web/src/domain/vtodo.js";
import { canonical, fixture, lines } from "./helpers.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const ROUND_TRIP = ["tasksorg-subtask.ics", "thunderbird-tzid.ics", "apple-completed.ics", "haken-attachment.ics"];

describe("round-trip", () => {
  for (const name of ROUND_TRIP) {
    test(`${name}: parse + serialize keeps every property and parameter`, () => {
      const ics = fixture(name);
      const out = serialize(parseResource(ics));
      assert.deepEqual(canonical(out), canonical(ics));
    });
    test(`${name}: an edit keeps every unrelated line`, () => {
      const ics = fixture(name);
      const { ics: out, groups } = applyEdit(ics, { kind: "summary", value: "Changed" }, NOW);
      assert.deepEqual(groups, ["SUMMARY"]);
      const touched = /^vcalendar\/vtodo\/\["(summary|last-modified|dtstamp)"/;
      const before = [...canonical(ics)].filter((l) => !touched.test(l));
      const after = canonical(out);
      for (const line of before) assert.ok(after.has(line), `lost: ${line}`);
      assert.ok(new Set(lines(out)).has("SUMMARY:Changed"));
      assert.ok(new Set(lines(out)).has("LAST-MODIFIED:20261104T100000Z"));
    });
  }
});

describe("readTask", () => {
  test("Tasks.org step", () => {
    const v = readTask(parseResource(fixture("tasksorg-subtask.ics")));
    assert.equal(v.parentUid, "7c6b5a49-3827-4615-a4b3-c2d1e0f9a8b7");
    assert.equal(v.important, false, "PRIORITY 9 is low, not important");
    assert.equal(v.sortOrder, 815079612);
    assert.equal(v.done, false);
  });
  test("Thunderbird TZID due resolves via VTIMEZONE", () => {
    const v = readTask(parseResource(fixture("thunderbird-tzid.ics")));
    assert.deepEqual(v.due, { kind: "date-time", instant: Date.UTC(2026, 10, 10, 16, 0, 0) });
    assert.deepEqual(v.categories, ["Example label", "Second"]);
    assert.equal(v.description, "Line one\nLine two, with comma");
    assert.equal(v.status, "IN-PROCESS");
    assert.equal(v.sortOrder, Math.floor(Date.UTC(2026, 9, 28, 10, 10, 10) / 1000) - APPLE_EPOCH_SECONDS);
  });
  test("Apple completed with URI attachment and DATE due", () => {
    const v = readTask(parseResource(fixture("apple-completed.ics")));
    assert.equal(v.done, true);
    assert.deepEqual(v.due, { kind: "date", date: "2026-10-01" });
    assert.equal(v.attachments[0]?.kind, "uri");
  });
  test("binary attachment", () => {
    const r = parseResource(fixture("haken-attachment.ics"));
    const v = readTask(r);
    assert.deepEqual(v.attachments[0], {
      kind: "binary",
      index: 0,
      filename: "hello.txt",
      mediaType: "text/plain",
      size: 5,
    });
    assert.equal(new TextDecoder().decode(attachmentData(r, 0).bytes), "hello");
  });
  test("repeating task is flagged", () => {
    assert.equal(readTask(parseResource(fixture("repeating.ics"))).repeats, true);
  });
});

describe("strict input", () => {
  for (const [name, property] of [
    ["invalid-priority.ics", "PRIORITY"],
    ["invalid-status.ics", "STATUS"],
  ] as const) {
    test(`${name} is rejected with the property named`, () => {
      assert.throws(
        () => readTask(parseResource(fixture(name))),
        (e: unknown) => e instanceof InvalidInputError && e.context["property"] === property,
      );
    });
  }
  test("garbage is rejected", () => {
    assert.throws(() => parseResource("not ical"), InvalidInputError);
  });
  test("VEVENT in a task resource is rejected", () => {
    const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:x\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    assert.throws(() => parseResource(ics), InvalidInputError);
  });
  test("malformed DUE is rejected", () => {
    const ics = fixture("invalid-status.ics").replace("STATUS:DONE", "DUE;VALUE=DATE:20261345");
    assert.throws(() => readTask(parseResource(ics)), InvalidInputError);
  });
  test("TZID without VTIMEZONE is rejected", () => {
    const ics = fixture("invalid-status.ics").replace("STATUS:DONE", "DUE;TZID=Europe/Berlin:20261110T170000");
    assert.throws(() => readTask(parseResource(ics)), InvalidInputError);
  });
});

describe("edits", () => {
  const base = createTask(
    { uid: "u-1", summary: "First", sortOrder: 10, parentUid: null, important: false, due: null },
    NOW,
  );
  test("createTask writes a valid minimal VTODO", () => {
    const v = readTask(parseResource(base));
    assert.equal(v.summary, "First");
    assert.equal(v.sortOrder, 10);
    assert.match(base, /PRODID:-\/\/haken\/\/haken\/\/EN/);
    assert.match(base, /X-APPLE-SORT-ORDER:10\r\n/);
  });
  test("done sets the completion group", () => {
    const r = applyEdit(base, { kind: "done", value: true }, NOW);
    assert.deepEqual(r.groups, ["COMPLETION"]);
    const v = readTask(parseResource(r.ics));
    assert.equal(v.done, true);
    assert.equal(v.completedAt, NOW.getTime());
    const back = readTask(parseResource(applyEdit(r.ics, { kind: "done", value: false }, NOW).ics));
    assert.equal(back.done, false);
    assert.equal(back.completedAt, null);
  });
  test("star and unstar follow RFC 5545 ranges", () => {
    const starred = applyEdit(base, { kind: "important", value: true }, NOW).ics;
    assert.match(starred, /PRIORITY:1/);
    const unstarred = applyEdit(starred, { kind: "important", value: false }, NOW).ics;
    assert.match(unstarred, /PRIORITY:0/);
    const low = fixture("tasksorg-subtask.ics");
    assert.deepEqual(applyEdit(low, { kind: "important", value: false }, NOW).groups, []);
  });
  test("no-op edits change nothing", () => {
    const r = applyEdit(base, { kind: "summary", value: "First" }, NOW);
    assert.deepEqual(r.groups, []);
    assert.equal(r.ics, base);
  });
  test("due date and labels", () => {
    const d = applyEdit(base, { kind: "due", value: { kind: "date", date: "2026-11-05" } }, NOW).ics;
    assert.match(d, /DUE;VALUE=DATE:20261105/);
    const c = applyEdit(d, { kind: "categories", value: ["b", "a", "b"] }, NOW).ics;
    assert.deepEqual(readTask(parseResource(c)).categories, ["b", "a"]);
  });
  test("attachments", () => {
    const a = applyEdit(
      base,
      { kind: "addAttachment", filename: "x.txt", mediaType: "text/plain", base64: "aGk=" },
      NOW,
    ).ics;
    const v = readTask(parseResource(a));
    assert.equal(v.attachments.length, 1);
    const removed = applyEdit(a, { kind: "removeAttachment", index: 0 }, NOW).ics;
    assert.equal(readTask(parseResource(removed)).attachments.length, 0);
  });
  test("repeating tasks are read-only", () => {
    assert.throws(() => applyEdit(fixture("repeating.ics"), { kind: "summary", value: "x" }, NOW));
  });
});
