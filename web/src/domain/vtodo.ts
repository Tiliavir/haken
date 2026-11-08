/**
 * VTODO resources: parsing, strict validation, the read model (`TaskView`),
 * edits and creation ([data mapping](../../../docs/arc42/adr/ADR-20261103-vtodo-mapping.md)).
 *
 * Edits always modify the parsed component in place, so properties and
 * parameters haken does not interpret are written back untouched.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { byCodeUnit } from "./compare.js";
import { HakenError, InvalidInputError, unreachable } from "./errors.js";
import {
  advance,
  followDue,
  previousDue,
  type Recurrence,
  readRecurrence,
  sameRecurrence,
  writeRecurrence,
} from "./recurrence.js";

export type Component = InstanceType<typeof ICAL.Component>;
export type Property = InstanceType<typeof ICAL.Property>;

export const PRODID = "-//haken//haken//EN";

/** Marks a task as put on *Focus* by the user; the value is that day ([Focus ADR](../../../docs/arc42/adr/ADR-20261104-focus.md)). */
export const FOCUS_PROP = "x-haken-focus";

/** Manual order of a task inside its part of *Focus* (integer, ascending). */
export const FOCUS_ORDER_PROP = "x-haken-focus-order";

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
  /** Has `RRULE`/`RDATE`. */
  readonly repeats: boolean;
  /** The rule if haken can edit it; `repeats` without `recurrence`: see `ruleLocked`. */
  readonly recurrence: Recurrence | null;
  /** Day the task was put on *Focus* (`YYYY-MM-DD`), `null` if not. It stays until removed. */
  readonly focus: string | null;
  /** Manual order inside *Focus*; `null` = by due date or by the day added. */
  readonly focusOrder: number | null;
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
    else if (stack.at(-1) === "VTODO" && /^RRULE[;:]/.test(upper)) {
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
  // Validated in a fixed order: with several invalid properties the first one is reported.
  const uid = readUid(todo, prodid);
  const summary = readText(todo, "summary", prodid);
  const description = readText(todo, "description", prodid);
  const status = readStatus(todo, prodid);
  const priority = readInteger(todo, "PRIORITY", 0, 9, prodid) ?? 0;
  readInteger(todo, "PERCENT-COMPLETE", 0, 100, prodid);
  const due = readDue(resource, prodid);
  const completedAt = readInstant(resource, "completed", prodid);
  const created = readInstant(resource, "created", prodid);
  const lastModified = readInstant(resource, "last-modified", prodid);
  const dtstamp = readInstant(resource, "dtstamp", prodid);
  const categories = readCategories(todo, prodid);
  const sortOrder = readSortOrder(todo, created ?? dtstamp ?? 0, prodid);
  const parentUid = readParent(todo, uid, prodid);
  const recurrence = readRecurrence(todo, resource.rawRules, prodid);
  const focus = readFocus(todo, prodid);
  const focusOrder = readFocusOrder(todo, prodid);
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
    focus,
    focusOrder,
    prodid,
  };
}

function readUid(todo: Component, prodid: string | null): string {
  const uidProp = single(todo, "uid", prodid);
  if (uidProp === null) invalid("VTODO without UID", ctx("UID", "", prodid));
  const uid = textValue(uidProp, prodid);
  if (uid.trim() === "") invalid("Empty UID", ctx("UID", "", prodid));
  return uid;
}

/** A single text property; absent is "". */
function readText(todo: Component, name: string, prodid: string | null): string {
  const prop = single(todo, name, prodid);
  return prop === null ? "" : textValue(prop, prodid);
}

function readStatus(todo: Component, prodid: string | null): Status {
  const statusProp = single(todo, "status", prodid);
  if (statusProp === null) return "NEEDS-ACTION";
  const value = textValue(statusProp, prodid).toUpperCase();
  if (!STATUSES.has(value)) invalid("Unknown STATUS", ctx("STATUS", value, prodid));
  return value as Status;
}

/** A single INTEGER property within `min`…`max`; null if absent. */
function readInteger(
  todo: Component,
  name: string,
  min: number,
  max: number,
  prodid: string | null,
): number | null {
  const prop = single(todo, name.toLowerCase(), prodid);
  if (prop === null) return null;
  const [, , type, value] = jcalOf(prop);
  if (
    type !== "integer" ||
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > max
  ) {
    invalid(`${name} must be an integer ${min}-${max}`, ctx(name, String(value), prodid));
  }
  return value;
}

/** A single DATE-TIME property as an instant; null if absent. */
function readInstant(resource: ParsedResource, name: string, prodid: string | null): number | null {
  const prop = single(resource.todo, name, prodid);
  return prop === null ? null : dateTimeInstant(resource, prop, prodid);
}

function readDue(resource: ParsedResource, prodid: string | null): Due | null {
  const dueProp = single(resource.todo, "due", prodid);
  if (dueProp === null) return null;
  const [, , type, value] = jcalOf(dueProp);
  if (type !== "date")
    return { kind: "date-time", instant: dateTimeInstant(resource, dueProp, prodid) };
  if (typeof value !== "string" || !checkDateString(value)) {
    invalid("Malformed DUE date", ctx("DUE", String(value), prodid));
  }
  return { kind: "date", date: value };
}

function readCategories(todo: Component, prodid: string | null): string[] {
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
  return categories;
}

/** `X-APPLE-SORT-ORDER`; absent: seconds since the Apple epoch of `fallbackMs` (creation). */
function readSortOrder(todo: Component, fallbackMs: number, prodid: string | null): number {
  const orderProp = single(todo, "x-apple-sort-order", prodid);
  if (orderProp === null) return Math.floor(fallbackMs / 1000) - APPLE_EPOCH_SECONDS;
  const [, , , value] = jcalOf(orderProp);
  const text = String(value);
  if (!INTEGER_RE.test(text))
    invalid("X-APPLE-SORT-ORDER must be an integer", ctx("X-APPLE-SORT-ORDER", text, prodid));
  return Number(text);
}

/** The UID of the parent task (`RELATED-TO`, `RELTYPE=PARENT` is the default). */
function readParent(todo: Component, uid: string, prodid: string | null): string | null {
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
  return parentUid;
}

function readFocus(todo: Component, prodid: string | null): string | null {
  const focusProp = single(todo, FOCUS_PROP, prodid);
  if (focusProp === null) return null;
  const raw = String(focusProp.getFirstValue());
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (m === null || !validDate(Number(m[1]), Number(m[2]), Number(m[3]))) {
    invalid("X-HAKEN-FOCUS must be a date YYYYMMDD", ctx(FOCUS_PROP, raw, prodid));
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function readFocusOrder(todo: Component, prodid: string | null): number | null {
  const focusOrderProp = single(todo, FOCUS_ORDER_PROP, prodid);
  if (focusOrderProp === null) return null;
  const raw = String(focusOrderProp.getFirstValue());
  if (!INTEGER_RE.test(raw)) {
    invalid("X-HAKEN-FOCUS-ORDER must be an integer", ctx(FOCUS_ORDER_PROP, raw, prodid));
  }
  return Number(raw);
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
    let padding = 0;
    if (value.endsWith("=")) padding = value.endsWith("==") ? 2 : 1;
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
  const bytes = Uint8Array.from(binary, (c) => {
    const code = c.codePointAt(0);
    if (code === undefined) throw new HakenError("domain", "Empty character from atob", { index });
    return code;
  });
  return { bytes, mediaType: attachment.mediaType, filename: attachment.filename };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCodePoint(...bytes.subarray(i, i + chunk));
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
  /** Put on *Focus* (`value`: that day, `YYYY-MM-DD`) or take it off (`null`). */
  | { readonly kind: "focus"; readonly value: string | null }
  | { readonly kind: "focusOrder"; readonly value: number }
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

/** A floating date-time with the device-local wall-clock time of `instant`, to the minute. */
function floating(instant: number): InstanceType<typeof ICAL.Time> {
  if (!Number.isSafeInteger(instant))
    throw new HakenError("domain", "Invalid due time", { value: instant });
  const d = new Date(instant);
  return ICAL.Time.fromData({
    year: d.getFullYear(),
    month: d.getMonth() + 1,
    day: d.getDate(),
    hour: d.getHours(),
    minute: d.getMinutes(),
    second: 0,
    isDate: false,
  });
}

function setText(todo: Component, name: string, value: string): boolean {
  const current = todo.getFirstPropertyValue(name);
  if (value === "") {
    // ical.js's removeAllProperties returns nothing; check first.
    if (!todo.hasProperty(name)) return false;
    todo.removeAllProperties(name);
    return true;
  }
  if (current === value) return false;
  todo.updatePropertyWithValue(name, value);
  return true;
}

function touch(todo: Component, now: Date): void {
  todo.updatePropertyWithValue("last-modified", isoUtc(now));
  todo.updatePropertyWithValue("dtstamp", isoUtc(now));
}

/**
 * Repeats by a rule haken cannot edit: the rule and what depends on it (completion, due and start
 * dates) stay untouched; everything else is editable (ADR-20261108-rule-locked-edits).
 */
export function ruleLocked(view: TaskView): boolean {
  return view.repeats && view.recurrence === null;
}

/** Property groups that depend on the repeat rule. */
const RULE_GROUPS: ReadonlySet<string> = new Set([
  "COMPLETION",
  "DUE",
  "DTSTART",
  "RRULE",
  "RDATE",
  "EXDATE",
]);

function ruleBound(edit: TaskEdit): boolean {
  switch (edit.kind) {
    case "done":
    case "due":
    case "recurrence":
      return true;
    case "restoreGroup":
      return RULE_GROUPS.has(edit.group);
    default:
      return false;
  }
}

export interface EditResult {
  readonly ics: string;
  /** Property groups changed by the edit (empty: nothing changed, `ics` is the input). */
  readonly groups: readonly string[];
}

/**
 * Applies one edit to a resource. Throws for an edit that depends on a repeat rule haken cannot edit
 * (ADR-20261108-rule-locked-edits) and for edits that do not fit the resource.
 */
export function applyEdit(ics: string, edit: TaskEdit, now: Date): EditResult {
  const resource = parseResource(ics);
  const view = readTask(resource);
  if (ruleLocked(view) && ruleBound(edit)) {
    throw new HakenError("domain", "This edit depends on a repeat rule haken cannot edit", {
      uid: view.uid,
      edit: edit.kind,
    });
  }
  const groups = new Set(editGroups(resource.todo, view, edit, now));
  if (groups.size === 0) return { ics, groups: [] };
  touch(resource.todo, now);
  const out = serialize(resource);
  // The result must stay readable: an edit never produces an invalid task.
  readTask(parseResource(out));
  return { ics: out, groups: [...groups] };
}

type EditOf<K extends TaskEdit["kind"]> = Extract<TaskEdit, { readonly kind: K }>;

/** Applies the edit to `todo`; returns the property groups it changed. */
function editGroups(todo: Component, view: TaskView, edit: TaskEdit, now: Date): string[] {
  const changed = (yes: boolean, name: string): string[] => (yes ? [groupOf(name)] : []);
  switch (edit.kind) {
    case "summary":
      return changed(setText(todo, "summary", edit.value), "summary");
    case "description":
      return changed(setText(todo, "description", edit.value), "description");
    case "done":
      return editDone(todo, view, edit, now);
    case "important":
      if (edit.value === view.important) return [];
      todo.updatePropertyWithValue("priority", edit.value ? 1 : 0);
      return ["PRIORITY"];
    case "due":
      return editDue(todo, view, edit);
    case "focus":
      return editFocus(todo, view, edit);
    case "focusOrder":
      return editFocusOrder(todo, view, edit);
    case "recurrence":
      return editRecurrence(todo, view, edit);
    case "categories":
      return changed(setCategories(todo, view.categories, edit.value), "categories");
    case "sortOrder":
      return editSortOrder(todo, edit);
    case "parent":
      return editParent(todo, view, edit);
    case "addAttachment":
      return addAttachment(todo, edit);
    case "removeAttachment":
      return removeAttachment(todo, view, edit);
    case "restoreGroup":
      return replaceGroup(todo, edit.group, edit.lines) ? [edit.group] : [];
    default:
      return unreachable(edit, "domain");
  }
}

/** Reopens: NEEDS-ACTION without COMPLETED and PERCENT-COMPLETE. */
function reopen(todo: Component): void {
  todo.updatePropertyWithValue("status", "NEEDS-ACTION");
  todo.removeAllProperties("completed");
  todo.removeAllProperties("percent-complete");
}

function editDone(todo: Component, view: TaskView, edit: EditOf<"done">, now: Date): string[] {
  // Completing a repeating task advances it and it stays open, unless this was its last occurrence.
  const advanced =
    edit.value && !view.done && view.recurrence !== null ? advance(todo, view.recurrence) : null;
  if (advanced !== null && advanced !== "last") {
    const groups = advanced.map(groupOf);
    if (
      todo.hasProperty("percent-complete") ||
      todo.hasProperty("completed") ||
      view.status !== "NEEDS-ACTION"
    ) {
      reopen(todo);
      groups.push("COMPLETION");
    }
    return groups;
  }
  if (edit.value === view.done && !(edit.value && view.status === "CANCELLED")) return [];
  if (edit.value) {
    todo.updatePropertyWithValue("status", "COMPLETED");
    todo.updatePropertyWithValue("completed", isoUtc(now));
    todo.updatePropertyWithValue("percent-complete", 100);
  } else {
    reopen(todo);
  }
  return ["COMPLETION"];
}

function editDue(todo: Component, view: TaskView, edit: EditOf<"due">): string[] {
  const previous = previousDue(todo);
  if (!setDue(todo, view.due, edit.value)) return [];
  if (view.recurrence === null) return ["DUE"];
  if (edit.value === null) {
    // No due date, no schedule: removing the date ends the repetition.
    writeRecurrence(todo, null);
    return ["DUE", "RRULE"];
  }
  return ["DUE", ...followDue(todo, previous, view.recurrence)];
}

function editFocus(todo: Component, view: TaskView, edit: EditOf<"focus">): string[] {
  if (edit.value === view.focus || (edit.value !== null && view.focus !== null)) return [];
  todo.removeAllProperties(FOCUS_PROP);
  if (edit.value !== null) {
    if (!checkDateString(edit.value))
      throw new HakenError("domain", "Invalid Focus date", { value: edit.value });
    todo.addPropertyWithValue(FOCUS_PROP, edit.value.replaceAll("-", ""));
    return ["X-HAKEN-FOCUS"];
  }
  if (!todo.hasProperty(FOCUS_ORDER_PROP)) return ["X-HAKEN-FOCUS"];
  // Taken off Focus: its place there goes too.
  todo.removeAllProperties(FOCUS_ORDER_PROP);
  return ["X-HAKEN-FOCUS-ORDER", "X-HAKEN-FOCUS"];
}

function editFocusOrder(todo: Component, view: TaskView, edit: EditOf<"focusOrder">): string[] {
  if (!Number.isSafeInteger(edit.value)) {
    throw new HakenError("domain", "Focus order must be a safe integer", { value: edit.value });
  }
  if (edit.value === view.focusOrder) return [];
  todo.removeAllProperties(FOCUS_ORDER_PROP);
  todo.addPropertyWithValue(FOCUS_ORDER_PROP, String(edit.value));
  return ["X-HAKEN-FOCUS-ORDER"];
}

function editRecurrence(todo: Component, view: TaskView, edit: EditOf<"recurrence">): string[] {
  if (sameRecurrence(view.recurrence, edit.value)) return [];
  const groups: string[] = [];
  if (edit.value !== null && view.due === null) {
    setDue(todo, null, { kind: "date", date: edit.today });
    groups.push("DUE");
  }
  const hadStart = todo.hasProperty("dtstart");
  writeRecurrence(todo, edit.value);
  groups.push("RRULE");
  if (!hadStart && todo.hasProperty("dtstart")) groups.push("DTSTART");
  return groups;
}

function editSortOrder(todo: Component, edit: EditOf<"sortOrder">): string[] {
  if (!Number.isSafeInteger(edit.value)) {
    throw new HakenError("domain", "Sort order must be a safe integer", { value: edit.value });
  }
  const current = todo.getFirstProperty("x-apple-sort-order");
  if (current !== null && String(current.getFirstValue()) === String(edit.value)) return [];
  todo.removeAllProperties("x-apple-sort-order");
  todo.addPropertyWithValue("x-apple-sort-order", String(edit.value));
  return ["X-APPLE-SORT-ORDER"];
}

function editParent(todo: Component, view: TaskView, edit: EditOf<"parent">): string[] {
  if (edit.value === view.parentUid) return [];
  for (const prop of todo.getAllProperties("related-to")) {
    const reltype = prop.getFirstParameter("reltype");
    if (typeof reltype !== "string" || reltype.toUpperCase() === "PARENT")
      todo.removeProperty(prop);
  }
  if (edit.value !== null) todo.addPropertyWithValue("related-to", edit.value);
  return ["RELATED-TO"];
}

function addAttachment(todo: Component, edit: EditOf<"addAttachment">): string[] {
  const prop = new ICAL.Property("attach", todo);
  prop.resetType("binary");
  prop.setParameter("encoding", "BASE64");
  prop.setParameter("fmttype", edit.mediaType);
  prop.setParameter("filename", edit.filename);
  prop.setValue(edit.base64);
  todo.addProperty(prop);
  return ["ATTACH"];
}

function removeAttachment(
  todo: Component,
  view: TaskView,
  edit: EditOf<"removeAttachment">,
): string[] {
  const prop = todo.getAllProperties("attach")[edit.index];
  if (prop === undefined) {
    throw new HakenError("domain", "Attachment index out of range", {
      uid: view.uid,
      index: edit.index,
    });
  }
  todo.removeProperty(prop);
  return ["ATTACH"];
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
    prop.setValue(floating(next.instant));
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
  /** Put on *Focus* on this day (`YYYY-MM-DD`). */
  readonly focus?: string | null;
  readonly categories?: readonly string[];
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
  setCategories(todo, [], task.categories ?? []);
  if (task.focus !== undefined && task.focus !== null) {
    if (!checkDateString(task.focus))
      throw new HakenError("domain", "Invalid Focus date", { value: task.focus });
    todo.addPropertyWithValue(FOCUS_PROP, task.focus.replaceAll("-", ""));
  }
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
  return [...groupsOf(parseResource(ics).todo)].sort(byCodeUnit);
}
