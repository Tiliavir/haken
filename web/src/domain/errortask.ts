/**
 * Error tasks in the list "errorlogs" (ADR-20261104-strict-errors). Pure
 * construction; `app/errors.ts` decides when to write them.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { HakenError } from "./errors.js";
import { createTask, parseResource, readTask, serialize } from "./vtodo.js";

export const ERRORLOGS = "errorlogs";
export const FINGERPRINT_PROP = "x-haken-error-fingerprint";
const COUNT_PROP = "x-haken-error-count";

export interface ErrorReport {
  readonly name: string;
  readonly message: string;
  readonly layer: string;
  /** Plain-text lines `key: value`, already free of credentials and task content. */
  readonly details: readonly string[];
  readonly stack: string;
}

/** FNV-1a (64 bit, hex) over name, message and the top stack frame. Not security relevant. */
export function fingerprint(name: string, message: string, stack: string): string {
  const top =
    stack
      .split("\n")
      .find((l) => /^\s*at\s|@/.test(l))
      ?.trim() ?? "";
  const input = `${name}\u0000${message}\u0000${top}`;
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

export function errorSummary(report: ErrorReport): string {
  const s = `${report.name}: ${report.message}`;
  return s.length > 120 ? s.slice(0, 120) : s;
}

function description(report: ErrorReport, count: number, now: Date): string {
  return [
    `Message: ${report.message}`,
    `Layer: ${report.layer}`,
    ...report.details,
    `Occurrences: ${count}`,
    `Last seen (UTC): ${now.toISOString()}`,
    "",
    "Stack:",
    report.stack,
  ].join("\n");
}

export function createErrorTask(
  uid: string,
  report: ErrorReport,
  print: string,
  sortOrder: number,
  now: Date,
): string {
  const base = createTask(
    { uid, summary: errorSummary(report), sortOrder, parentUid: null, important: false, due: null },
    now,
  );
  const resource = parseResource(base);
  const todo = resource.todo;
  todo.addPropertyWithValue("description", description(report, 1, now));
  const categories = new ICAL.Property("categories", todo);
  categories.setValues(["error", report.layer]);
  todo.addProperty(categories);
  todo.addPropertyWithValue(FINGERPRINT_PROP, print);
  todo.addPropertyWithValue(COUNT_PROP, "1");
  const ics = serialize(resource);
  readTask(parseResource(ics));
  return ics;
}

/** Updates an open error task with one more occurrence. */
export function bumpErrorTask(ics: string, report: ErrorReport, now: Date): string {
  const resource = parseResource(ics);
  const todo = resource.todo;
  const current = Number(todo.getFirstPropertyValue(COUNT_PROP) ?? "1");
  if (!Number.isInteger(current) || current < 1) {
    throw new HakenError("domain", "Error task has an invalid count", {
      property: COUNT_PROP.toUpperCase(),
    });
  }
  const count = current + 1;
  todo.updatePropertyWithValue(COUNT_PROP, String(count));
  todo.updatePropertyWithValue("description", description(report, count, now));
  const stamp = ICAL.Time.fromJSDate(new Date(Math.floor(now.getTime() / 1000) * 1000), true);
  todo.updatePropertyWithValue("last-modified", stamp);
  todo.updatePropertyWithValue("dtstamp", stamp);
  return serialize(resource);
}

export function fingerprintOf(ics: string): string | null {
  const value = parseResource(ics).todo.getFirstPropertyValue(FINGERPRINT_PROP);
  return typeof value === "string" ? value : null;
}
