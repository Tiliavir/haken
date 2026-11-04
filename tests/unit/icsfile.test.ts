import assert from "node:assert/strict";
import { test } from "node:test";
import { joinIcsFile, splitIcsFile } from "../../web/src/domain/icsfile.js";
import { fixture } from "./helpers.js";

test("join then split returns the same tasks with their time zones", () => {
  const files = ["thunderbird-tzid.ics", "apple-completed.ics", "tasksorg-subtask.ics"].map(
    fixture,
  );
  const joined = joinIcsFile(files);
  const { items, problems } = splitIcsFile(joined);
  assert.deepEqual(problems, []);
  assert.equal(items.length, 3);
  assert.match(items[0]?.ics ?? "", /BEGIN:VTIMEZONE/);
  assert.doesNotMatch(items[1]?.ics ?? "", /BEGIN:VTIMEZONE/);
});
test("invalid items are reported, valid ones kept", () => {
  const joined = joinIcsFile([fixture("apple-completed.ics")]).replace(
    "END:VCALENDAR",
    "BEGIN:VTODO\r\nUID:bad\r\nPRIORITY:42\r\nEND:VTODO\r\nEND:VCALENDAR",
  );
  const { items, problems } = splitIcsFile(joined);
  assert.equal(items.length, 1);
  assert.deepEqual(
    problems.map((p) => [p.uid, p.property]),
    [["bad", "PRIORITY"]],
  );
});
