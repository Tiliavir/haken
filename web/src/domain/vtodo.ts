/**
 * VTODO resources: parsing, strict validation, the read model (`TaskView`),
 * edits and creation ([data mapping](../../../docs/arc42/adr/ADR-20261103-vtodo-mapping.md)).
 *
 * Edits always modify the parsed component in place, so properties and
 * parameters haken does not interpret are written back untouched.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { HakenError, InvalidInputError, unreachable } from "./errors.js";
import {
  advance,
  dueTime,
  followDue,
  type Recurrence,
  readRecurrence,
  sameRecurrence,
  writeRecurrence,
} from "./recurrence.js";

export type Component = InstanceType<typeof ICAL.Component>;
export type Property = InstanceType<typeof ICAL.Property>;

export const PRODID = "-//haken//haken//EN";

/** Apple's reference date (2001-01-01T00:00:00Z) in Unix seconds; base of `X-APPLE-SORT-ORDER` defaults. */
export const APPLE_EPOCH_SECONDS = 978_307_200;

export type Status = "NEEDS-ACTION" | "IN-PROCESS" | "COMPLETED" | "CANCELLED";
const STATUSES: ReadonlySet<string> = new Set([
  "NEEDS-ACTION",
  "IN-PROCESS",
  "COMPLETED",
  "CANCELLED",
]);

/** A due value as written in the resource. */
export type Due =
  | { readonly kind: "date"; readonly date: string }
  | { readonly kind: "date-time"; readonly instant: number };

export type Attachment =
  | {
      readonly kind: "binary";
      readonly index: number;
      readonly filename: string | null;
      readonly mediaType: string | null;
      readonly size: number;
    }
  | {
      readonly kind: "uri";
      readonly index: number;
      readonly filename: string | null;
      readonly uri: string;
    };

export interface TaskView {
  readonly uid: string;
  readonly summary: string;
  readonly description: string;
  readonly status: Status;
  /** `COMPLETED` or `CANCELLED`. */
  readonly done: boolean;
  readonly completedAt: number | null;
  readonly important: boolean;
  readonly due: Due | null;
  readonly categories: readonly string[];
  /** Effective manual order: `X-APPLE-SORT-ORDER`, else seconds since 2001-01-01 of `CREATED`/`DTSTAMP`. */
  readonly sortOrder: number;
  readonly parentUid: string | null;
  readonly attachments: readonly Attachment[];
  readonly created: number | null;
  readonly lastModified: number | null;
  /** Has `RRULE`/`RDATE`: haken shows it read-only (recurrence is not supported). */
  readonly repeats: boolean;
  /** The rule if haken can edit it; `repeats` without `recurrence` means read-only. */
  readonly recurrence: Recurrence | null;
  readonly prodid: string | null;
}

export interface ParsedResource {
  readonly calendar: Component;
  readonly todo: Component;
  /** `RRULE` values as written (ical.js repairs some invalid ones; validation needs the original). */
  readonly rawRules: readonly string[];
}

/** `RRULE` values of the VTODO itself (not of VTIMEZONE or VALARM), from the unfolded raw text. */
function rawRulesOf(ics: string): string[] {
  const out: string[] = [];
  const stack: string[] = [];
  for (const line of ics.replace(/\r?\n[ \t]/g, "").split(/\r?\n/)) {
    const upper = line.toUpperCase();
    if (upper.startsWith("BEGIN:")) stack.push(upper.slice(6));
    else if (upper.startsWith("END:")) stack.pop();
    else if (stack[stack.length - 1] === "VTODO" && /^RRULE[;:]/.test(upper)) {
      out.push(line.slice(line.indexOf(":") + 1));
    }
  }
  return out;
}

// ---------------------------------------------------------------- parsing

function invalid(message: string, context: Record<string, string>): never {
  throw new InvalidInputError("domain", message, context);
}

/** Parses one CalDAV task resource. Throws `InvalidInputError` for anything but one VCALENDAR with one VTODO. */
export function parseResource(ics: string): ParsedResource {
  let jcal: unknown;
  try {
    jcal = ICAL.parse(ics);
  } catch (cause) {
    throw new InvalidInputError(
      "domain",
      "iCalendar syntax error",
      { reason: cause instanceof Error ? cause.message : String(cause) },
      { cause },
    );
  }
  if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") {
    invalid("Resource is not a single VCALENDAR", { property: "BEGIN" });
  }
  const calendar = new ICAL.Component(jcal);
  const todos = calendar.getAllSubcomponents("vtodo");
  for (const sub of calendar.getAllSubcomponents()) {
    if (sub.name !== "vtodo" && sub.name !== "vtimezone") {
      invalid("Unexpected component in task resource", { property: sub.name.toUpperCase() });
    }
  }
  if (todos.length !== 1) {
    invalid("Task resource must contain exactly one VTODO", {
      property: "VTODO",
      value: String(todos.length),
      reason: todos.length > 1 ? "recurrence overrides are not supported" : "no VTODO",
    });
  }
  const todo = todos[0] as Component;
  return { calendar, todo, rawRules: rawRulesOf(ics) };
}

export function serialize(resource: ParsedResource): string {
  return `${resource.calendar.toString()}\r\n`;
}

// ---------------------------------------------------------------- validation helpers

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z?)$/;
const INTEGER_RE = /^-?\d{1,15}$/;

type JCalProperty = [string, Record<string, unknown>, string, ...unknown[]];

function jcalOf(prop: Property): JCalProperty {
  return prop.toJSON() as JCalProperty;
}

function single(todo: Component, name: string, prodid: string | null): Property | null {
  const all = todo.getAllProperties(name);
  if (all.length > 1) {
    invalid("Property must occur at most once", ctx(name, String(all.length), prodid));
  }
  return all[0] ?? null;
}

function ctx(property: string, value: string, prodid: string | null): Record<string, string> {
  return { property: property.toUpperCase(), value: value.slice(0, 80), prodid: prodid ?? "" };
}

function textValue(prop: Property, prodid: string | null): string {
  const [name, , type, ...values] = jcalOf(prop);
  if (type !== "text" || values.length !== 1 || typeof values[0] !== "string") {
    invalid("Expected a single text value", ctx(name, String(values[0]), prodid));
  }
  return values[0];
}

function validDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= days;
}

function checkDateString(value: string): boolean {
  const m = DATE_RE.exec(value);
  return m !== null && validDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function checkDateTimeString(value: string): RegExpExecArray | null {
  const m = DATE_TIME_RE.exec(value);
  if (m === null) return null;
  if (!validDate(Number(m[1]), Number(m[2]), Number(m[3]))) return null;
  if (Number(m[4]) > 23 || Number(m[5]) > 59 || Number(m[6]) > 60) return null;
  return m;
}

/**
 * Resolves a DATE-TIME property to a UTC instant (ms). UTC and `TZID`
 * (resolved through the resource's VTIMEZONE) are exact; floating values are
 * read in the device's time zone.
 */
function dateTimeInstant(resource: ParsedResource, prop: Property, prodid: string | null): number {
  const [name, params, type, ...values] = jcalOf(prop);
  const value = values[0];
  if (type !== "date-time" || values.length !== 1 || typeof value !== "string") {
    invalid("Expected a single DATE-TIME value", ctx(name, String(value), prodid));
  }
  const m = checkDateTimeString(value);
  if (m === null) invalid("Malformed DATE-TIME value", ctx(name, value, prodid));
  const tzid = params["tzid"];
  const [y, mo, d, h, mi, s] = [m[1], m[2], m[3], m[4], m[5], m[6]].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (m[7] === "Z") {
    if (tzid !== undefined) invalid("UTC DATE-TIME must not carry TZID", ctx(name, value, prodid));
    return Date.UTC(y, mo - 1, d, h, mi, Math.min(s, 59));
  }
  if (tzid === undefined) {
    return new Date(y, mo - 1, d, h, mi, Math.min(s, 59)).getTime();
  }
  if (typeof tzid !== "string") invalid("Malformed TZID", ctx(name, value, prodid));
  const vtz = resource.calendar
    .getAllSubcomponents("vtimezone")
    .find((c) => c.getFirstPropertyValue("tzid") === tzid);
  if (vtz === undefined) {
    invalid("TZID without matching VTIMEZONE", ctx(name, `${value};TZID=${tzid}`, prodid));
  }
  const zone = new ICAL.Timezone(vtz);
  const time = new ICAL.Time(
    { year: y, month: mo, day: d, hour: h, minute: mi, second: Math.min(s, 59), isDate: false },
    zone,
  );
  return time.toUnixTime() * 1000;
}

// ---------------------------------------------------------------- read model

/** Validates every property haken interprets and returns the read model. Throws `InvalidInputError`. */
export function readTask(resource: ParsedResource): TaskView {
  const todo = resource.todo;
  const prodidValue = resource.calendar.getFirstPropertyValue("prodid");
  const prodid = typeof prodidValue === "string" ? prodidValue : null;

  const uidProp = single(todo, "uid", prodid);
  if (uidProp === null) invalid("VTODO without UID", ctx("UID", "", prodid));
  const uid = textValue(uidProp, prodid);
  if (uid.trim() === "") invalid("Empty UID", ctx("UID", "", prodid));

  const summaryProp = single(todo, "summary", prodid);
  const summary = summaryProp === null ? "" : textValue(summaryProp, prodid);
  const descriptionProp = single(todo, "description", prodid);
  const description = descriptionProp === null ? "" : textValue(descriptionProp, prodid);

  const statusProp = single(todo, "status", prodid);
  let status: Status = "NEEDS-ACTION";
  if (statusProp !== null) {
    const value = textValue(statusProp, prodid).toUpperCase();
    if (!STATUSES.has(value)) invalid("Unknown STATUS", ctx("STATUS", value, prodid));
    status = value as Status;
  }

  const priorityProp = single(todo, "priority", prodid);
  let priority = 0;
  if (priorityProp !== null) {
    const [, , type, value] = jcalOf(priorityProp);
    if (
      type !== "integer" ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 9
    ) {
      invalid("PRIORITY must be an integer 0-9", ctx("PRIORITY", String(value), prodid));
    }
    priority = value;
  }

  const percentProp = single(todo, "percent-complete", prodid);
  if (percentProp !== null) {
    const [, , type, value] = jcalOf(percentProp);
    if (
      type !== "integer" ||
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < 0 ||
      value > 100
    ) {
      invalid(
        "PERCENT-COMPLETE must be an integer 0-100",
        ctx("PERCENT-COMPLETE", String(value), prodid),
      );
    }
  }

  const dueProp = single(todo, "due", prodid);
  let due: Due | null = null;
  if (dueProp !== null) {
    const [, , type, value] = jcalOf(dueProp);
    if (type === "date") {
      if (typeof value !== "string" || !checkDateString(value)) {
        invalid("Malformed DUE date", ctx("DUE", String(value), prodid));
      }
      due = { kind: "date", date: value };
    } else {
      due = { kind: "date-time", instant: dateTimeInstant(resource, dueProp, prodid) };
    }
  }

  const completedProp = single(todo, "completed", prodid);
  const completedAt =
    completedProp === null ? null : dateTimeInstant(resource, completedProp, prodid);
  const createdProp = single(todo, "created", prodid);
  const created = createdProp === null ? null : dateTimeInstant(resource, createdProp, prodid);
  const modifiedProp = single(todo, "last-modified", prodid);
  const lastModified =
    modifiedProp === null ? null : dateTimeInstant(resource, modifiedProp, prodid);
  const stampProp = single(todo, "dtstamp", prodid);
  const dtstamp = stampProp === null ? null : dateTimeInstant(resource, stampProp, prodid);

  const categories: string[] = [];
  for (const prop of todo.getAllProperties("categories")) {
    const [, , type, ...values] = jcalOf(prop);
    if (type !== "text") invalid("CATEGORIES must be text", ctx("CATEGORIES", type, prodid));
    for (const v of values) {
      if (typeof v !== "string")
        invalid("CATEGORIES must be text", ctx("CATEGORIES", String(v), prodid));
      if (v !== "" && !categories.includes(v)) categories.push(v);
    }
  }

  const orderProp = single(todo, "x-apple-sort-order", prodid);
  let sortOrder: number;
  if (orderProp !== null) {
    const [, , , value] = jcalOf(orderProp);
    const text = String(value);
    if (!INTEGER_RE.test(text))
      invalid("X-APPLE-SORT-ORDER must be an integer", ctx("X-APPLE-SORT-ORDER", text, prodid));
    sortOrder = Number(text);
  } else {
    const base = created ?? dtstamp ?? 0;
    sortOrder = Math.floor(base / 1000) - APPLE_EPOCH_SECONDS;
  }

  let parentUid: string | null = null;
  for (const prop of todo.getAllProperties("related-to")) {
    const reltype = prop.getFirstParameter("reltype");
    const kind = typeof reltype === "string" ? reltype.toUpperCase() : "PARENT";
    if (kind !== "PARENT") continue;
    const value = textValue(prop, prodid);
    if (parentUid !== null)
      invalid("More than one parent RELATED-TO", ctx("RELATED-TO", value, prodid));
    if (value === "" || value === uid)
      invalid("Invalid parent RELATED-TO", ctx("RELATED-TO", value, prodid));
    parentUid = value;
  }

  const recurrence = readRecurrence(todo, resource.rawRules, prodid);

  const attachments = todo
    .getAllProperties("attach")
    .map((prop, index) => readAttachment(prop, index, prodid));

  return {
    uid,
    summary,
    description,
    status,
    done: status === "COMPLETED" || status === "CANCELLED",
    completedAt,
    important: priority >= 1 && priority <= 4,
    due,
    categories,
    sortOrder,
    parentUid,
    attachments,
    created,
    lastModified,
    repeats: recurrence.repeats,
    recurrence: recurrence.rule,
    prodid,
  };
}

function readAttachment(prop: Property, index: number, prodid: string | null): Attachment {
  const [, params, type, ...values] = jcalOf(prop);
  const value = values[0];
  if (values.length !== 1 || typeof value !== "string") {
    invalid("ATTACH must have one value", ctx("ATTACH", String(value), prodid));
  }
  const filename = typeof params["filename"] === "string" ? params["filename"] : null;
  const fmt = typeof params["fmttype"] === "string" ? params["fmttype"] : null;
  if (type === "binary") {
    const encoding = params["encoding"];
    if (typeof encoding !== "string" || encoding.toUpperCase() !== "BASE64") {
      invalid("Binary ATTACH must be ENCODING=BASE64", ctx("ATTACH", String(encoding), prodid));
    }
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 !== 0) {
      invalid("Malformed base64 in ATTACH", ctx("ATTACH", `length ${value.length}`, prodid));
    }
    const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
    return {
      kind: "binary",
      index,
      filename,
      mediaType: fmt,
      size: (value.length / 4) * 3 - padding,
    };
  }
  if (type !== "uri") invalid("ATTACH must be URI or BINARY", ctx("ATTACH", type, prodid));
  return { kind: "uri", index, filename, uri: value };
}

/** Returns the decoded content of a binary attachment. */
export function attachmentData(
  resource: ParsedResource,
  index: number,
): {
  readonly bytes: Uint8Array;
  readonly mediaType: string | null;
  readonly filename: string | null;
} {
  const prop = resource.todo.getAllProperties("attach")[index];
  if (prop === undefined)
    throw new HakenError("domain", "Attachment index out of range", { index });
  const attachment = readAttachment(prop, index, null);
  if (attachment.kind !== "binary")
    throw new HakenError("domain", "Attachment is not binary", { index });
  const [, , , value] = jcalOf(prop);
  const binary = atob(String(value));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, mediaType: attachment.mediaType, filename: attachment.filename };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ---------------------------------------------------------------- edits

export type TaskEdit =
  | { readonly kind: "summary"; readonly value: string }
  | { readonly kind: "description"; readonly value: string }
  | { readonly kind: "done"; readonly value: boolean }
  | { readonly kind: "important"; readonly value: boolean }
  | { readonly kind: "due"; readonly value: Due | null }
  /** `today` (device date) becomes the due date if the task has none. */
  | { readonly kind: "recurrence"; readonly value: Recurrence | null; readonly today: string }
  | { readonly kind: "categories"; readonly value: readonly string[] }
  | { readonly kind: "sortOrder"; readonly value: number }
  | { readonly kind: "parent"; readonly value: string | null }
  | {
      readonly kind: "addAttachment";
      readonly filename: string;
      readonly mediaType: string;
      readonly base64: string;
    }
  | { readonly kind: "removeAttachment"; readonly index: number }
  /** Writes a property group back from a conflict note ("Use this value"). */
  | { readonly kind: "restoreGroup"; readonly group: string; readonly lines: string };

/** Property groups that change together; merge and outbox work on these keys. */
export const GROUPS: Readonly<Record<string, readonly string[]>> = {
  COMPLETION: ["status", "completed", "percent-complete"],
};

/** Properties that are bookkeeping, not content: never merged, never conflict. */
export const UNMERGED: ReadonlySet<string> = new Set([
  "uid",
  "dtstamp",
  "last-modified",
  "sequence",
]);

export function groupOf(propertyName: string): string {
  const lower = propertyName.toLowerCase();
  for (const [group, members] of Object.entries(GROUPS)) {
    if (members.includes(lower)) return group;
  }
  return lower.toUpperCase();
}

function isoUtc(date: Date): InstanceType<typeof ICAL.Time> {
  return ICAL.Time.fromJSDate(new Date(Math.floor(date.getTime() / 1000) * 1000), true);
}

function setText(todo: Component, name: string, value: string): boolean {
  const current = todo.getFirstPropertyValue(name);
  if (value === "") {
    return todo.removeAllProperties(name);
  }
  if (current === value) return false;
  todo.updatePropertyWithValue(name, value);
  return true;
}

function touch(todo: Component, now: Date): void {
  todo.updatePropertyWithValue("last-modified", isoUtc(now));
  todo.updatePropertyWithValue("dtstamp", isoUtc(now));
}

export interface EditResult {
  readonly ics: string;
  /** Property groups changed by the edit (empty: nothing changed, `ics` is the input). */
  readonly groups: readonly string[];
}

/**
 * Applies one edit to a resource. Throws for read-only tasks (repeating in a way haken cannot edit) and
 * for edits that do not fit the resource.
 */
export function applyEdit(ics: string, edit: TaskEdit, now: Date): EditResult {
  const resource = parseResource(ics);
  const view = readTask(resource);
  if (view.repeats && view.recurrence === null) {
    throw new HakenError("domain", "This repeating task is read-only", { uid: view.uid });
  }
  const todo = resource.todo;
  const groups = new Set<string>();
  const mark = (changed: boolean, name: string): void => {
    if (changed) groups.add(groupOf(name));
  };

  switch (edit.kind) {
    case "summary":
      mark(setText(todo, "summary", edit.value), "summary");
      break;
    case "description":
      mark(setText(todo, "description", edit.value), "description");
      break;
    case "done":
      if (edit.value && !view.done && view.recurrence !== null) {
        // Completing a repeating task advances it; it stays open.
        for (const name of advance(todo, view.recurrence)) groups.add(groupOf(name));
        if (
          todo.hasProperty("percent-complete") ||
          todo.hasProperty("completed") ||
          view.status !== "NEEDS-ACTION"
        ) {
          todo.updatePropertyWithValue("status", "NEEDS-ACTION");
          todo.removeAllProperties("completed");
          todo.removeAllProperties("percent-complete");
          groups.add("COMPLETION");
        }
        break;
      }
      if (edit.value !== view.done || (edit.value && view.status === "CANCELLED")) {
        if (edit.value) {
          todo.updatePropertyWithValue("status", "COMPLETED");
          todo.updatePropertyWithValue("completed", isoUtc(now));
          todo.updatePropertyWithValue("percent-complete", 100);
        } else {
          todo.updatePropertyWithValue("status", "NEEDS-ACTION");
          todo.removeAllProperties("completed");
          todo.removeAllProperties("percent-complete");
        }
        groups.add("COMPLETION");
      }
      break;
    case "important":
      if (edit.value !== view.important) {
        todo.updatePropertyWithValue("priority", edit.value ? 1 : 0);
        groups.add("PRIORITY");
      }
      break;
    case "due": {
      const previous = dueTime(todo);
      if (!setDue(todo, view.due, edit.value)) break;
      groups.add("DUE");
      if (view.recurrence !== null) {
        if (edit.value === null) {
          // No due date, no schedule: removing the date ends the repetition.
          writeRecurrence(todo, null);
          groups.add("RRULE");
        } else if (followDue(todo, previous)) {
          groups.add("DTSTART");
        }
      }
      break;
    }
    case "recurrence": {
      if (sameRecurrence(view.recurrence, edit.value)) break;
      if (edit.value !== null && view.due === null) {
        setDue(todo, null, { kind: "date", date: edit.today });
        groups.add("DUE");
      }
      const hadStart = todo.hasProperty("dtstart");
      writeRecurrence(todo, edit.value);
      groups.add("RRULE");
      if (!hadStart && todo.hasProperty("dtstart")) groups.add("DTSTART");
      break;
    }
    case "categories":
      mark(setCategories(todo, view.categories, edit.value), "categories");
      break;
    case "sortOrder": {
      if (!Number.isSafeInteger(edit.value)) {
        throw new HakenError("domain", "Sort order must be a safe integer", { value: edit.value });
      }
      const current = todo.getFirstProperty("x-apple-sort-order");
      if (current === null || String(current.getFirstValue()) !== String(edit.value)) {
        todo.removeAllProperties("x-apple-sort-order");
        todo.addPropertyWithValue("x-apple-sort-order", String(edit.value));
        groups.add("X-APPLE-SORT-ORDER");
      }
      break;
    }
    case "parent":
      if (edit.value !== view.parentUid) {
        for (const prop of todo.getAllProperties("related-to")) {
          const reltype = prop.getFirstParameter("reltype");
          if (typeof reltype !== "string" || reltype.toUpperCase() === "PARENT")
            todo.removeProperty(prop);
        }
        if (edit.value !== null) todo.addPropertyWithValue("related-to", edit.value);
        groups.add("RELATED-TO");
      }
      break;
    case "addAttachment": {
      const prop = new ICAL.Property("attach", todo);
      prop.resetType("binary");
      prop.setParameter("encoding", "BASE64");
      prop.setParameter("fmttype", edit.mediaType);
      prop.setParameter("filename", edit.filename);
      prop.setValue(edit.base64);
      todo.addProperty(prop);
      groups.add("ATTACH");
      break;
    }
    case "removeAttachment": {
      const prop = todo.getAllProperties("attach")[edit.index];
      if (prop === undefined) {
        throw new HakenError("domain", "Attachment index out of range", {
          uid: view.uid,
          index: edit.index,
        });
      }
      todo.removeProperty(prop);
      groups.add("ATTACH");
      break;
    }
    case "restoreGroup":
      if (replaceGroup(todo, edit.group, edit.lines)) groups.add(edit.group);
      break;
    default:
      unreachable(edit, "domain");
  }

  if (groups.size === 0) return { ics, groups: [] };
  touch(todo, now);
  const out = serialize(resource);
  // The result must stay readable: an edit never produces an invalid task.
  readTask(parseResource(out));
  return { ics: out, groups: [...groups] };
}

function sameDue(a: Due | null, b: Due | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === "date" && b.kind === "date") return a.date === b.date;
  if (a.kind === "date-time" && b.kind === "date-time") return a.instant === b.instant;
  return false;
}

function setDue(todo: Component, current: Due | null, next: Due | null): boolean {
  if (sameDue(current, next)) return false;
  todo.removeAllProperties("due");
  if (next === null) return true;
  const prop = new ICAL.Property("due", todo);
  if (next.kind === "date") {
    if (!checkDateString(next.date))
      throw new HakenError("domain", "Invalid due date", { value: next.date });
    prop.resetType("date");
    prop.setValue(ICAL.Time.fromDateString(next.date));
  } else {
    prop.resetType("date-time");
    prop.setValue(isoUtc(new Date(next.instant)));
  }
  todo.addProperty(prop);
  return true;
}

function setCategories(
  todo: Component,
  current: readonly string[],
  next: readonly string[],
): boolean {
  const clean: string[] = [];
  for (const label of next) {
    const trimmed = label.trim();
    if (trimmed === "") throw new HakenError("domain", "Empty label");
    if (!clean.includes(trimmed)) clean.push(trimmed);
  }
  if (clean.length === current.length && clean.every((v, i) => v === current[i])) return false;
  todo.removeAllProperties("categories");
  if (clean.length > 0) {
    const prop = new ICAL.Property("categories", todo);
    prop.setValues(clean);
    todo.addProperty(prop);
  }
  return true;
}

// ---------------------------------------------------------------- property groups (merge, conflict notes)

/** Serialized lines of one property group (subcomponents count as the group named like the component). */
export function groupLines(todo: Component, group: string): string {
  const lines: string[] = [];
  for (const prop of todo.getAllProperties()) {
    if (groupOf(prop.name) === group) lines.push(prop.toICALString());
  }
  for (const sub of todo.getAllSubcomponents()) {
    if (sub.name.toUpperCase() === group) lines.push(sub.toString());
  }
  return lines.join("\r\n");
}

/** All group keys present in a VTODO, excluding bookkeeping properties. */
export function groupsOf(todo: Component): Set<string> {
  const out = new Set<string>();
  for (const prop of todo.getAllProperties()) {
    if (!UNMERGED.has(prop.name)) out.add(groupOf(prop.name));
  }
  for (const sub of todo.getAllSubcomponents()) out.add(sub.name.toUpperCase());
  return out;
}

/** Replaces a group with the given serialized lines (empty: removes the group). Returns whether anything changed. */
export function replaceGroup(todo: Component, group: string, lines: string): boolean {
  if (groupLines(todo, group) === lines) return false;
  const isSub =
    !Object.hasOwn(GROUPS, group) && todo.getAllSubcomponents(group.toLowerCase()).length > 0;
  for (const prop of todo.getAllProperties()) {
    if (groupOf(prop.name) === group) todo.removeProperty(prop);
  }
  if (isSub || lines.startsWith("BEGIN:")) todo.removeAllSubcomponents(group.toLowerCase());
  if (lines === "") return true;
  const wrapper = new ICAL.Component(
    ICAL.parse(`BEGIN:VCALENDAR\r\nBEGIN:VTODO\r\n${lines}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`),
  );
  const source = wrapper.getFirstSubcomponent("vtodo");
  if (source === null) throw new HakenError("domain", "Group lines did not parse", { group });
  for (const prop of source.getAllProperties()) {
    if (groupOf(prop.name) !== group) {
      throw new HakenError("domain", "Group lines contain a foreign property", {
        group,
        property: prop.name,
      });
    }
    todo.addProperty(new ICAL.Property(prop.toJSON(), todo));
  }
  for (const sub of source.getAllSubcomponents()) {
    if (sub.name.toUpperCase() !== group) {
      throw new HakenError("domain", "Group lines contain a foreign component", {
        group,
        property: sub.name,
      });
    }
    todo.addSubcomponent(new ICAL.Component(sub.toJSON()));
  }
  return true;
}

// ---------------------------------------------------------------- creation

export interface NewTask {
  readonly uid: string;
  readonly summary: string;
  readonly sortOrder: number;
  readonly parentUid: string | null;
  readonly important: boolean;
  readonly due: Due | null;
}

export function createTask(task: NewTask, now: Date): string {
  if (task.uid.trim() === "") throw new HakenError("domain", "Empty UID");
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", PRODID);
  const todo = new ICAL.Component("vtodo", calendar);
  calendar.addSubcomponent(todo);
  todo.addPropertyWithValue("uid", task.uid);
  todo.addPropertyWithValue("dtstamp", isoUtc(now));
  todo.addPropertyWithValue("created", isoUtc(now));
  todo.addPropertyWithValue("last-modified", isoUtc(now));
  if (task.summary !== "") todo.addPropertyWithValue("summary", task.summary);
  todo.addPropertyWithValue("status", "NEEDS-ACTION");
  if (task.important) todo.addPropertyWithValue("priority", 1);
  if (task.parentUid !== null) todo.addPropertyWithValue("related-to", task.parentUid);
  if (!Number.isSafeInteger(task.sortOrder)) {
    throw new HakenError("domain", "Sort order must be a safe integer", { value: task.sortOrder });
  }
  todo.addPropertyWithValue("x-apple-sort-order", String(task.sortOrder));
  setDue(todo, null, task.due);
  const resource: ParsedResource = { calendar, todo, rawRules: [] };
  const ics = serialize(resource);
  readTask(parseResource(ics));
  return ics;
}

/** Seconds since 2001-01-01 for `now`; the default for a new list's first task order. */
export function appleSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000) - APPLE_EPOCH_SECONDS;
}

/** Property groups present in a resource (used for the outbox entry of a create or import). */
export function resourceGroups(ics: string): string[] {
  return [...groupsOf(parseResource(ics).todo)].sort();
}
