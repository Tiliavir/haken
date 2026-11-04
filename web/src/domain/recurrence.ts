/**
 * Repeating tasks ([ADR](../../../docs/arc42/adr/ADR-20261104-recurrence.md)).
 *
 * haken edits a supported subset of `RRULE`: `FREQ` daily, weekly, monthly
 * or yearly, `INTERVAL`, and plain weekdays in `BYDAY` for weekly rules.
 * Any other valid rule (`COUNT`, `UNTIL`, `BYMONTHDAY`, `RDATE`, `EXDATE`,
 * …) is preserved and makes the task read-only. An invalid rule is invalid
 * input.
 *
 * Completing a repeating task advances the same VTODO: `DUE` moves to the
 * next occurrence after the current one and `DTSTART` moves by the same
 * amount. Occurrences are computed on the written wall-clock fields, so
 * `TZID`, UTC and floating values keep their form and their time of day.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { HakenError, InvalidInputError } from "./errors.js";

type Component = InstanceType<typeof ICAL.Component>;
type Time = InstanceType<typeof ICAL.Time>;

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const FREQUENCIES: readonly Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];
const ALL_FREQUENCIES = new Set(["SECONDLY", "MINUTELY", "HOURLY", ...FREQUENCIES]);
const MAX_INTERVAL = 999;

/** The editable rule. `byDay` is only used with `WEEKLY`; empty means "the due date's weekday". */
export interface Recurrence {
  readonly freq: Frequency;
  readonly interval: number;
  readonly byDay: readonly Weekday[];
}

export interface RecurrenceInfo {
  /** Has `RRULE` or `RDATE`. */
  readonly repeats: boolean;
  /** The rule if haken can edit and advance it, else `null` (read-only). */
  readonly rule: Recurrence | null;
}

function fail(message: string, value: string, prodid: string | null): never {
  throw new InvalidInputError("domain", message, {
    property: "RRULE",
    value: value.slice(0, 80),
    prodid: prodid ?? "",
  });
}

/** Validates a recurrence in haken's own model. Throws `HakenError`. */
export function checkRecurrence(rule: Recurrence): void {
  if (!FREQUENCIES.includes(rule.freq))
    throw new HakenError("domain", "Unsupported frequency", { value: rule.freq });
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > MAX_INTERVAL) {
    throw new HakenError("domain", "Interval must be an integer 1-999", { value: rule.interval });
  }
  if (rule.byDay.length > 0 && rule.freq !== "WEEKLY") {
    throw new HakenError("domain", "Weekdays are only supported for weekly rules", {
      value: rule.freq,
    });
  }
  if (
    rule.byDay.some((d) => !WEEKDAYS.includes(d)) ||
    new Set(rule.byDay).size !== rule.byDay.length
  ) {
    throw new HakenError("domain", "Invalid weekdays", { value: rule.byDay.join(",") });
  }
}

const RULE_KEYS = new Set([
  "FREQ",
  "UNTIL",
  "COUNT",
  "INTERVAL",
  "BYSECOND",
  "BYMINUTE",
  "BYHOUR",
  "BYDAY",
  "BYMONTHDAY",
  "BYYEARDAY",
  "BYWEEKNO",
  "BYMONTH",
  "BYSETPOS",
  "WKST",
]);
const LIST_RE: Readonly<Record<string, RegExp>> = {
  BYSECOND: /^\d{1,2}$/,
  BYMINUTE: /^\d{1,2}$/,
  BYHOUR: /^\d{1,2}$/,
  BYDAY: /^[+-]?(\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/,
  BYMONTHDAY: /^[+-]?\d{1,2}$/,
  BYYEARDAY: /^[+-]?\d{1,3}$/,
  BYWEEKNO: /^[+-]?\d{1,2}$/,
  BYMONTH: /^\d{1,2}$/,
  BYSETPOS: /^[+-]?\d{1,3}$/,
};

/**
 * Parses an `RRULE` value as written (RFC 5545 3.3.10), strictly. ical.js
 * repairs some invalid values silently (`INTERVAL=0` becomes 1), so the raw
 * text is checked here.
 */
export function parseRule(text: string, prodid: string | null): Map<string, string> {
  const parts = new Map<string, string>();
  for (const part of text.split(";")) {
    const eq = part.indexOf("=");
    const key = part.slice(0, eq).toUpperCase();
    const value = part.slice(eq + 1).toUpperCase();
    if (eq <= 0 || value === "" || !RULE_KEYS.has(key) || parts.has(key))
      fail("Invalid RRULE part", text, prodid);
    parts.set(key, value);
  }
  const freq = parts.get("FREQ");
  if (freq === undefined || !ALL_FREQUENCIES.has(freq))
    fail("RRULE without valid FREQ", text, prodid);
  for (const key of ["INTERVAL", "COUNT"]) {
    const v = parts.get(key);
    if (v !== undefined && (!/^\d{1,6}$/.test(v) || Number(v) < 1))
      fail(`Invalid ${key}`, text, prodid);
  }
  if (parts.has("COUNT") && parts.has("UNTIL")) fail("COUNT and UNTIL together", text, prodid);
  const until = parts.get("UNTIL");
  if (until !== undefined && !/^\d{8}(T\d{6}Z?)?$/.test(until)) fail("Invalid UNTIL", text, prodid);
  const wkst = parts.get("WKST");
  if (wkst !== undefined && !WEEKDAYS.includes(wkst as Weekday)) fail("Invalid WKST", text, prodid);
  for (const [key, re] of Object.entries(LIST_RE)) {
    const v = parts.get(key);
    if (v?.split(",").some((item) => !re.test(item))) fail(`Invalid ${key}`, text, prodid);
  }
  return parts;
}

/**
 * Reads and validates the recurrence. `rawRules` are the `RRULE` values as
 * written in the resource. Throws `InvalidInputError` for an invalid rule.
 */
export function readRecurrence(
  todo: Component,
  rawRules: readonly string[],
  prodid: string | null,
): RecurrenceInfo {
  if (rawRules.length !== todo.getAllProperties("rrule").length) {
    fail("RRULE could not be read", String(rawRules.length), prodid);
  }
  if (rawRules.length === 0) return { repeats: todo.hasProperty("rdate"), rule: null };
  if (rawRules.length > 1) fail("More than one RRULE", String(rawRules.length), prodid);
  const parts = parseRule(rawRules[0] as string, prodid);
  const freq = parts.get("FREQ") as string;
  const interval = Number(parts.get("INTERVAL") ?? "1");
  const days = parts.get("BYDAY")?.split(",") ?? [];
  const extra = todo.hasProperty("rdate") || todo.hasProperty("exdate");
  const anchored = todo.hasProperty("due") || todo.hasProperty("dtstart");
  const editable =
    !extra &&
    anchored &&
    [...parts.keys()].every(
      (k) =>
        k === "FREQ" ||
        k === "INTERVAL" ||
        k === "BYDAY" ||
        (k === "WKST" && parts.get(k) === "MO"),
    ) &&
    FREQUENCIES.includes(freq as Frequency) &&
    interval <= MAX_INTERVAL &&
    days.every((d) => WEEKDAYS.includes(d as Weekday)) &&
    (days.length === 0 || freq === "WEEKLY");
  if (!editable) return { repeats: true, rule: null };
  return {
    repeats: true,
    rule: { freq: freq as Frequency, interval, byDay: WEEKDAYS.filter((d) => days.includes(d)) },
  };
}

export function ruleString(rule: Recurrence): string {
  checkRecurrence(rule);
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0)
    parts.push(`BYDAY=${WEEKDAYS.filter((d) => rule.byDay.includes(d)).join(",")}`);
  return parts.join(";");
}

export function sameRecurrence(a: Recurrence | null, b: Recurrence | null): boolean {
  if (a === null || b === null) return a === b;
  return ruleString(a) === ruleString(b);
}

/** Writes or removes the rule. A new rule gets a `DTSTART` equal to `DUE` (RFC 5545 pairs RRULE with DTSTART). */
export function writeRecurrence(todo: Component, rule: Recurrence | null): void {
  todo.removeAllProperties("rrule");
  if (rule === null) return;
  const due = todo.getFirstProperty("due");
  if (due === null) throw new HakenError("domain", "A repeating task needs a due date");
  if (!todo.hasProperty("dtstart")) {
    const start = new ICAL.Property(
      ["dtstart", ...(due.toJSON() as unknown[]).slice(1)] as unknown[],
      todo,
    );
    todo.addProperty(start);
  }
  const prop = new ICAL.Property("rrule", todo);
  prop.setValue(ICAL.Recur.fromString(ruleString(rule)));
  todo.addProperty(prop);
}

/** Wall-clock fields as a number, for zone-independent differences. */
function fieldsMs(t: Time): number {
  return Date.UTC(
    t.year,
    t.month - 1,
    t.day,
    t.isDate ? 0 : t.hour,
    t.isDate ? 0 : t.minute,
    t.isDate ? 0 : t.second,
  );
}

function shifted(t: Time, deltaMs: number): Time {
  const d = new Date(fieldsMs(t) + deltaMs);
  const out = t.clone();
  out.year = d.getUTCFullYear();
  out.month = d.getUTCMonth() + 1;
  out.day = d.getUTCDate();
  if (!t.isDate) {
    out.hour = d.getUTCHours();
    out.minute = d.getUTCMinutes();
    out.second = d.getUTCSeconds();
  }
  return out;
}

function timeOf(todo: Component, name: string): Time | null {
  const value = todo.getFirstPropertyValue(name);
  if (value === null) return null;
  if (!(value instanceof ICAL.Time))
    throw new HakenError("domain", "Date property is not a time", { property: name });
  return value;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Monday = 0 … Sunday = 6. */
function weekdayIndex(year: number, month: number, day: number): number {
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

/**
 * The next occurrence strictly after `from` (RFC 5545 semantics for the
 * supported subset, week start Monday). Months or years without the day are
 * skipped (31st, 29 February), as the RFC requires. Time of day is kept.
 */
export function nextOccurrence(rule: Recurrence, from: Time): Time {
  checkRecurrence(rule);
  const at = (y: number, m: number, d: number): Time => {
    const out = from.clone();
    out.year = y;
    out.month = m;
    out.day = d;
    return out;
  };
  const addDays = (n: number): Time => shifted(from, n * 86_400_000);
  const { year, month, day } = from;
  switch (rule.freq) {
    case "DAILY":
      return addDays(rule.interval);
    case "WEEKLY": {
      if (rule.byDay.length === 0) return addDays(7 * rule.interval);
      const wanted = rule.byDay.map((d) => WEEKDAYS.indexOf(d)).sort((a, b) => a - b);
      const today = weekdayIndex(year, month, day);
      const later = wanted.find((w) => w > today);
      if (later !== undefined) return addDays(later - today);
      // First wanted day in the week `interval` weeks after this one.
      return addDays(7 * rule.interval - today + (wanted[0] as number));
    }
    case "MONTHLY":
      for (let i = 1; i <= 1200; i++) {
        const total = month - 1 + i * rule.interval;
        const y = year + Math.floor(total / 12);
        const m = (total % 12) + 1;
        if (day <= daysInMonth(y, m)) return at(y, m, day);
      }
      break;
    case "YEARLY":
      for (let i = 1; i <= 400; i++) {
        const y = year + i * rule.interval;
        if (day <= daysInMonth(y, month)) return at(y, month, day);
      }
      break;
  }
  throw new HakenError("domain", "No next occurrence", { value: ruleString(rule) });
}

/**
 * Advances a repeating task to its next occurrence: `DUE` (or, without
 * `DUE`, `DTSTART`) moves to the next occurrence, `DTSTART` by the same
 * amount. Returns the changed property names.
 */
export function advance(todo: Component, rule: Recurrence): string[] {
  const due = timeOf(todo, "due");
  const start = timeOf(todo, "dtstart");
  const anchor = due ?? start;
  if (anchor === null) throw new HakenError("domain", "Repeating task without DUE or DTSTART");
  const next = nextOccurrence(rule, anchor);
  const delta = fieldsMs(next) - fieldsMs(anchor);
  const changed: string[] = [];
  if (due !== null) {
    (todo.getFirstProperty("due") as InstanceType<typeof ICAL.Property>).setValue(
      shifted(due, delta),
    );
    changed.push("due");
  }
  if (start !== null) {
    (todo.getFirstProperty("dtstart") as InstanceType<typeof ICAL.Property>).setValue(
      shifted(start, delta),
    );
    changed.push("dtstart");
  }
  return changed;
}

/**
 * Keeps `DTSTART` at the same distance from `DUE` when the user moves the
 * due date of a repeating task. Only when both are dates or both date-times.
 */
export function followDue(todo: Component, previous: Time | null): boolean {
  const due = timeOf(todo, "due");
  const start = timeOf(todo, "dtstart");
  if (
    previous === null ||
    due === null ||
    start === null ||
    due.isDate !== start.isDate ||
    previous.isDate !== due.isDate
  ) {
    return false;
  }
  const delta = fieldsMs(due) - fieldsMs(previous);
  if (delta === 0) return false;
  (todo.getFirstProperty("dtstart") as InstanceType<typeof ICAL.Property>).setValue(
    shifted(start, delta),
  );
  return true;
}

export function dueTime(todo: Component): Time | null {
  const value = timeOf(todo, "due");
  return value === null ? null : value.clone();
}
