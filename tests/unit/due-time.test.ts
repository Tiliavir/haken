// Due time of day (ADR-20261107-due-time). Times are built in the device's
// zone, so the assertions hold in any TZ the tests run in.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HakenError } from "../../web/src/domain/errors.js";
import { applyEdit, createTask, parseResource, readTask } from "../../web/src/domain/vtodo.js";
import { dueAt, dueClock } from "../../web/src/ui/views.js";
import { fixture, lines } from "./helpers.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const view = (ics: string) => readTask(parseResource(ics));
const has = (ics: string, line: string) => new Set(lines(ics)).has(line);
const edit = (ics: string, date: string, time: string) =>
  applyEdit(ics, { kind: "due", value: dueAt(date, time) }, NOW);

function repeating(rule: string, due = "20261102", start = due): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    "BEGIN:VTODO",
    "UID:t-1",
    "DTSTAMP:20261101T000000Z",
    "SUMMARY:Repeat",
    `DTSTART;VALUE=DATE:${start}`,
    `DUE;VALUE=DATE:${due}`,
    `RRULE:${rule}`,
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

describe("due time", () => {
  const plain = createTask(
    { uid: "d-1", summary: "x", sortOrder: 1, parentUid: null, important: false, due: null },
    NOW,
  );
  test("a time is written as a floating DATE-TIME; removing it writes a DATE", () => {
    const timed = edit(plain, "2026-11-10", "09:30");
    assert.deepEqual(timed.groups, ["DUE"]);
    assert.ok(has(timed.ics, "DUE:20261110T093000"));
    assert.deepEqual(view(timed.ics).due, {
      kind: "date-time",
      instant: new Date(2026, 10, 10, 9, 30).getTime(),
    });
    const untimed = edit(timed.ics, "2026-11-10", "");
    assert.ok(has(untimed.ics, "DUE;VALUE=DATE:20261110"));
  });
  test("the same time again changes nothing", () => {
    const timed = edit(plain, "2026-11-10", "09:30").ics;
    assert.deepEqual(edit(timed, "2026-11-10", "09:30").groups, []);
  });
  test("a time on a TZID due from another client is written floating", () => {
    const ics = applyEdit(
      fixture("thunderbird-tzid.ics"),
      { kind: "due", value: dueAt("2026-11-12", "08:15") },
      NOW,
    ).ics;
    assert.ok(has(ics, "DUE:20261112T081500"));
  });
});

describe("due time on repeating tasks", () => {
  test("adding a time: DTSTART takes it and keeps its distance in days", () => {
    const r = edit(repeating("FREQ=DAILY", "20261102", "20261101"), "2026-11-03", "09:00");
    assert.deepEqual([...r.groups].sort(), ["DTSTART", "DUE"]);
    assert.ok(has(r.ics, "DUE:20261103T090000"));
    assert.ok(has(r.ics, "DTSTART:20261102T090000"));
    assert.notEqual(view(r.ics).recurrence, null);
  });
  test("moving the time moves DTSTART by the same amount", () => {
    const timed = edit(repeating("FREQ=WEEKLY"), "2026-11-02", "09:00").ics;
    const r = edit(timed, "2026-11-02", "10:30");
    assert.deepEqual([...r.groups].sort(), ["DTSTART", "DUE"]);
    assert.ok(has(r.ics, "DTSTART:20261102T103000"));
  });
  test("removing the time: DTSTART becomes a date again", () => {
    const timed = edit(repeating("FREQ=WEEKLY"), "2026-11-02", "09:00").ics;
    const r = edit(timed, "2026-11-02", "");
    assert.ok(has(r.ics, "DUE;VALUE=DATE:20261102"));
    assert.ok(has(r.ics, "DTSTART;VALUE=DATE:20261102"));
  });
  test("UNTIL follows the form of DTSTART (RFC 5545) and stays editable", () => {
    const rule = repeating("FREQ=WEEKLY;UNTIL=20261231");
    const timed = edit(rule, "2026-11-02", "09:00");
    assert.deepEqual([...timed.groups].sort(), ["DTSTART", "DUE", "RRULE"]);
    assert.ok(has(timed.ics, "RRULE:FREQ=WEEKLY;UNTIL=20261231T235959"));
    assert.deepEqual(view(timed.ics).recurrence?.end, { kind: "until", date: "2026-12-31" });
    const untimed = edit(timed.ics, "2026-11-02", "");
    assert.ok(has(untimed.ics, "RRULE:FREQ=WEEKLY;UNTIL=20261231"));
  });
  test("completing keeps the floating wall-clock time across a DST change", () => {
    const timed = edit(repeating("FREQ=WEEKLY", "20270322"), "2027-03-22", "09:00").ics;
    const next = applyEdit(timed, { kind: "done", value: true }, NOW).ics;
    assert.ok(has(next, "DUE:20270329T090000"));
    assert.ok(has(next, "DTSTART:20270329T090000"));
  });
});

describe("date and time inputs", () => {
  test("dueAt and dueClock round-trip the inputs' values", () => {
    assert.deepEqual(dueAt("2026-11-10", ""), { kind: "date", date: "2026-11-10" });
    assert.equal(dueClock(dueAt("2026-11-10", "07:05")), "07:05");
    assert.equal(dueClock({ kind: "date", date: "2026-11-10" }), "");
  });
  test("anything else is an error", () => {
    for (const [date, time] of [
      ["2026-02-30", ""],
      ["10.11.2026", ""],
      ["2026-11-10", "24:00"],
      ["2026-11-10", "9:00"],
      ["2026-11-10", "09:00:00"],
    ] as const) {
      assert.throws(() => dueAt(date, time), HakenError, `${date} ${time}`);
    }
  });
});
