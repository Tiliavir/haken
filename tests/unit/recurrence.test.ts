import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { InvalidInputError } from "../../web/src/domain/errors.js";
import { merge } from "../../web/src/domain/merge.js";
import { ruleString } from "../../web/src/domain/recurrence.js";
import { applyEdit, createTask, parseResource, readTask } from "../../web/src/domain/vtodo.js";
import { canonical, fixture, lines } from "./helpers.js";

const NOW = new Date("2026-11-04T10:00:00Z");
const view = (ics: string) => readTask(parseResource(ics));
const has = (ics: string, line: string) => new Set(lines(ics)).has(line);
const complete = (ics: string) => applyEdit(ics, { kind: "done", value: true }, NOW);

function task(due: string | null, rule: string | null, start: string | null = due): string {
  const parts = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//test//test//EN",
    "BEGIN:VTODO",
    "UID:r-1",
    "DTSTAMP:20261101T000000Z",
    "SUMMARY:Repeat",
    ...(start === null ? [] : [`DTSTART;VALUE=DATE:${start}`]),
    ...(due === null ? [] : [`DUE;VALUE=DATE:${due}`]),
    ...(rule === null ? [] : [`RRULE:${rule}`]),
    "END:VTODO",
    "END:VCALENDAR",
    "",
  ];
  return parts.join("\r\n");
}

describe("reading rules", () => {
  test("supported rules become an editable recurrence", () => {
    assert.deepEqual(view(fixture("tasksorg-recurring.ics")).recurrence, {
      freq: "WEEKLY",
      interval: 2,
      byDay: [],
      monthlyNth: null,
      end: { kind: "never" },
    });
    assert.deepEqual(view(task("20261102", "FREQ=WEEKLY;BYDAY=FR,MO")).recurrence, {
      freq: "WEEKLY",
      interval: 1,
      byDay: ["MO", "FR"],
      monthlyNth: null,
      end: { kind: "never" },
    });
    assert.deepEqual(view(fixture("repeating.ics")).recurrence, {
      freq: "WEEKLY",
      interval: 1,
      byDay: [],
      monthlyNth: null,
      end: { kind: "never" },
    });
  });
  test("valid rules outside the subset lock the rule, completing and dates; the rest stays editable", () => {
    for (const ics of [
      task("20261102", "FREQ=MONTHLY;BYMONTHDAY=15"),
      task("20261102", "FREQ=MONTHLY;BYDAY=1MO,3MO"),
      task("20261102", "FREQ=HOURLY"),
      task("20261102", "FREQ=WEEKLY").replace(
        "END:VTODO",
        "EXDATE;VALUE=DATE:20261109\r\nEND:VTODO",
      ),
      task(null, "FREQ=DAILY", null),
    ]) {
      const v = view(ics);
      assert.equal(v.repeats, true);
      assert.equal(v.recurrence, null);
      for (const edit of [
        { kind: "done", value: true },
        { kind: "due", value: null },
        { kind: "recurrence", value: null, today: "2026-11-04" },
        { kind: "restoreGroup", group: "DUE", lines: "" },
        { kind: "restoreGroup", group: "COMPLETION", lines: "" },
      ] as const) {
        assert.throws(() => applyEdit(ics, edit, NOW), /repeat rule haken cannot edit/, edit.kind);
      }
      // Rule-independent edits change only their own lines; the rule stays as written.
      let out = ics;
      for (const edit of [
        { kind: "summary", value: "x" },
        { kind: "description", value: "note" },
        { kind: "important", value: true },
        { kind: "categories", value: ["A, b", "C"] },
        { kind: "sortOrder", value: 7 },
      ] as const) {
        out = applyEdit(out, edit, NOW).ics;
      }
      const own =
        /^(SUMMARY|DESCRIPTION|PRIORITY|CATEGORIES|X-APPLE-SORT-ORDER|DTSTAMP|LAST-MODIFIED)[:;]/;
      const rest = (text: string) => lines(text).filter((l) => !own.test(l));
      assert.deepEqual(rest(out), rest(ics));
      assert.deepEqual(view(out).categories, ["A, b", "C"]);
    }
  });
  test("invalid rules are invalid input", () => {
    for (const ics of [
      fixture("invalid-rrule.ics"),
      task("20261102", "FREQ=WEEKLY").replace("END:VTODO", "RRULE:FREQ=DAILY\r\nEND:VTODO"),
      task("20261102", "FREQ=WEEKLY;COUNT=2;UNTIL=20261201"),
      task("20261102", "FREQ=WEEKLY;FOO=1"),
    ]) {
      assert.throws(
        () => view(ics),
        (e: unknown) => e instanceof InvalidInputError && e.context["property"] === "RRULE",
        ics,
      );
    }
    // ical.js rejects some values already while parsing; still invalid input.
    assert.throws(() => view(task("20261102", "FREQ=WEEKLY;BYDAY=XX")), InvalidInputError);
  });
  test("per-occurrence overrides stay unreadable", () => {
    assert.throws(() => parseResource(fixture("invalid-recurrence-id.ics")), InvalidInputError);
  });
});

describe("completing advances the same task", () => {
  test("weekly from the due date; DTSTART follows; task stays open", () => {
    const r = complete(task("20261101", "FREQ=WEEKLY", "20261030"));
    assert.deepEqual([...r.groups].sort(), ["DTSTART", "DUE"]);
    const v = view(r.ics);
    assert.equal(v.done, false);
    assert.deepEqual(v.due, { kind: "date", date: "2026-11-08" });
    assert.ok(has(r.ics, "DTSTART;VALUE=DATE:20261106"));
    assert.ok(has(r.ics, "RRULE:FREQ=WEEKLY"));
  });
  test("weekly on chosen weekdays", () => {
    let ics = task("20261102", "FREQ=WEEKLY;BYDAY=MO,WE,FR");
    const dues: string[] = [];
    for (let i = 0; i < 4; i++) {
      ics = complete(ics).ics;
      const due = view(ics).due;
      dues.push(due?.kind === "date" ? due.date : "");
    }
    assert.deepEqual(dues, ["2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11"]);
  });
  test("every 3 days, monthly on the 31st (RFC skips short months), yearly on 29 February", () => {
    const next = (due: string, rule: string) => {
      const d = view(complete(task(due, rule)).ics).due;
      return d?.kind === "date" ? d.date : null;
    };
    assert.equal(next("20261130", "FREQ=DAILY;INTERVAL=3"), "2026-12-03");
    assert.equal(next("20270131", "FREQ=MONTHLY"), "2027-03-31");
    assert.equal(next("20280229", "FREQ=YEARLY"), "2032-02-29");
  });
  test("TZID date-times keep zone and wall-clock time across a DST change", () => {
    const original = fixture("thunderbird-recurring-tzid.ics");
    const r = complete(original);
    assert.ok(has(r.ics, "DUE;TZID=Europe/Berlin:20270329T090000"));
    assert.ok(has(r.ics, "DTSTART;TZID=Europe/Berlin:20270329T080000"));
    // 09:00 CET is 08:00Z; a week later 09:00 CEST is 07:00Z.
    assert.deepEqual(view(r.ics).due, {
      kind: "date-time",
      instant: Date.UTC(2027, 2, 29, 7, 0, 0),
    });
    const untouched = [...canonical(original)].filter(
      (l) => !/\["(due|dtstart|last-modified|dtstamp)"/.test(l),
    );
    const after = canonical(r.ics);
    for (const line of untouched) assert.ok(after.has(line), `lost: ${line}`);
  });
  test("a completed series from another client can still be reopened", () => {
    const done = task("20261102", "FREQ=WEEKLY").replace(
      "SUMMARY:Repeat",
      "SUMMARY:Repeat\r\nSTATUS:COMPLETED",
    );
    assert.equal(view(applyEdit(done, { kind: "done", value: false }, NOW).ics).done, false);
  });
});

describe("editing the rule", () => {
  const plain = createTask(
    { uid: "e-1", summary: "x", sortOrder: 1, parentUid: null, important: false, due: null },
    NOW,
  );
  test("setting a rule on a task without due date sets today and DTSTART", () => {
    const r = applyEdit(
      plain,
      {
        kind: "recurrence",
        value: {
          freq: "WEEKLY",
          interval: 1,
          byDay: ["MO", "TU", "WE", "TH", "FR"],
          monthlyNth: null,
          end: { kind: "never" },
        },
        today: "2026-11-04",
      },
      NOW,
    );
    assert.deepEqual([...r.groups].sort(), ["DTSTART", "DUE", "RRULE"]);
    assert.ok(has(r.ics, "RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"));
    assert.ok(has(r.ics, "DUE;VALUE=DATE:20261104"));
    assert.ok(has(r.ics, "DTSTART;VALUE=DATE:20261104"));
  });
  test("moving the due date moves DTSTART; removing it ends the repetition", () => {
    const repeating = task("20261102", "FREQ=DAILY", "20261101");
    const moved = applyEdit(
      repeating,
      { kind: "due", value: { kind: "date", date: "2026-11-10" } },
      NOW,
    ).ics;
    assert.ok(has(moved, "DTSTART;VALUE=DATE:20261109"));
    const removed = applyEdit(moved, { kind: "due", value: null }, NOW);
    assert.ok(removed.groups.includes("RRULE"));
    assert.equal(view(removed.ics).repeats, false);
  });
  test("removing the rule keeps the dates; rules are written canonically", () => {
    const r = applyEdit(
      task("20261102", "FREQ=WEEKLY;INTERVAL=2"),
      { kind: "recurrence", value: null, today: "2026-11-04" },
      NOW,
    );
    assert.deepEqual(r.groups, ["RRULE"]);
    assert.ok(has(r.ics, "DUE;VALUE=DATE:20261102"));
    assert.equal(
      ruleString({
        freq: "MONTHLY",
        interval: 1,
        byDay: [],
        monthlyNth: null,
        end: { kind: "never" },
      }),
      "FREQ=MONTHLY",
    );
    assert.throws(() =>
      ruleString({
        freq: "MONTHLY",
        interval: 1,
        byDay: ["MO"],
        monthlyNth: null,
        end: { kind: "never" },
      }),
    );
    assert.throws(() =>
      ruleString({
        freq: "DAILY",
        interval: 0,
        byDay: [],
        monthlyNth: null,
        end: { kind: "never" },
      }),
    );
  });
});

test("two devices completing the same occurrence offline do not conflict", () => {
  const base = task("20261102", "FREQ=WEEKLY");
  const a = complete(base).ics;
  const b = applyEdit(base, { kind: "done", value: true }, new Date("2026-11-04T11:00:00Z")).ics;
  const r = merge(
    base,
    a,
    b,
    new Map([
      ["DUE", NOW.getTime()],
      ["DTSTART", NOW.getTime()],
    ]),
  );
  assert.deepEqual(r.notes, []);
  assert.deepEqual(view(r.ics).due, { kind: "date", date: "2026-11-09" });
});

describe("ends and monthly weekdays", () => {
  const never = { kind: "never" } as const;
  test("COUNT counts down; the last occurrence completes for good (as Tasks.org)", () => {
    let ics = fixture("recurring-count.ics");
    assert.deepEqual(view(ics).recurrence?.end, { kind: "count", count: 5 });
    for (const left of [4, 3, 2, 1]) {
      ics = complete(ics).ics;
      assert.equal(view(ics).done, false);
      assert.deepEqual(view(ics).recurrence?.end, { kind: "count", count: left });
    }
    assert.ok(has(ics, "RRULE:FREQ=DAILY;COUNT=1"));
    ics = complete(ics).ics;
    assert.equal(view(ics).done, true);
    assert.deepEqual(view(ics).due, { kind: "date", date: "2026-11-05" });
  });
  test("UNTIL: past the end date the task completes for good", () => {
    let ics = task("20261102", "FREQ=WEEKLY;UNTIL=20261110");
    assert.deepEqual(view(ics).recurrence?.end, { kind: "until", date: "2026-11-10" });
    ics = complete(ics).ics;
    assert.deepEqual(view(ics).due, { kind: "date", date: "2026-11-09" });
    ics = complete(ics).ics;
    assert.equal(view(ics).done, true);
  });
  test("UNTIL in a form haken would not write back locks the rule", () => {
    assert.equal(view(task("20261102", "FREQ=WEEKLY;UNTIL=20261110T120000Z")).recurrence, null);
  });
  test("monthly on the second Tuesday and on the last Friday", () => {
    const next = (due: string, rule: string) => {
      const d = view(complete(task(due, rule)).ics).due;
      return d?.kind === "date" ? d.date : null;
    };
    assert.deepEqual(view(task("20261110", "FREQ=MONTHLY;BYDAY=2TU")).recurrence?.monthlyNth, {
      nth: 2,
      day: "TU",
    });
    assert.equal(next("20261110", "FREQ=MONTHLY;BYDAY=2TU"), "2026-12-08");
    assert.equal(next("20261127", "FREQ=MONTHLY;BYDAY=-1FR"), "2026-12-25");
    assert.equal(next("20261227", "FREQ=MONTHLY;INTERVAL=2;BYDAY=-1FR"), "2027-02-26");
    // A due date that is not an occurrence itself moves to the next one in the same month.
    assert.equal(next("20261101", "FREQ=MONTHLY;BYDAY=2TU"), "2026-11-10");
    assert.equal(view(task("20261110", "FREQ=MONTHLY;BYDAY=2TU,3TU")).recurrence, null);
  });
  test("rules with an end are written canonically", () => {
    assert.equal(
      ruleString({
        freq: "MONTHLY",
        interval: 1,
        byDay: [],
        monthlyNth: { nth: -1, day: "FR" },
        end: { kind: "count", count: 3 },
      }),
      "FREQ=MONTHLY;BYDAY=-1FR;COUNT=3",
    );
    assert.equal(
      ruleString({
        freq: "WEEKLY",
        interval: 2,
        byDay: [],
        monthlyNth: null,
        end: { kind: "until", date: "2026-12-31" },
      }),
      "FREQ=WEEKLY;INTERVAL=2;UNTIL=20261231",
    );
    assert.throws(() =>
      ruleString({
        freq: "WEEKLY",
        interval: 1,
        byDay: [],
        monthlyNth: { nth: 2, day: "TU" },
        end: never,
      }),
    );
    assert.throws(() =>
      ruleString({
        freq: "DAILY",
        interval: 1,
        byDay: [],
        monthlyNth: null,
        end: { kind: "count", count: 0 },
      }),
    );
  });
});
