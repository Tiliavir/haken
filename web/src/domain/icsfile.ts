/**
 * `.ics` files for export and import: one VCALENDAR holding many VTODOs.
 * A file is split into one resource per UID (with the VTIMEZONEs it uses),
 * exactly as CalDAV stores them.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { HakenError, InvalidInputError } from "./errors.js";
import { type Component, PRODID, parseResource, readTask, type TaskView } from "./vtodo.js";

export interface ImportItem {
  readonly ics: string;
  readonly view: TaskView;
}

export interface ImportProblem {
  readonly index: number;
  readonly uid: string | null;
  readonly message: string;
  readonly property: string;
}

export interface ImportResult {
  readonly items: readonly ImportItem[];
  readonly problems: readonly ImportProblem[];
}

/** Splits an `.ics` file into task resources. Items that fail validation are reported, never guessed. */
export function splitIcsFile(text: string): ImportResult {
  let calendar: Component;
  try {
    const jcal: unknown = ICAL.parse(text);
    if (!Array.isArray(jcal) || jcal[0] !== "vcalendar") throw new Error("not a VCALENDAR");
    calendar = new ICAL.Component(jcal);
  } catch (cause) {
    throw new InvalidInputError(
      "domain",
      "File is not a single iCalendar object",
      { reason: cause instanceof Error ? cause.message : String(cause) },
      { cause },
    );
  }
  const timezones = calendar.getAllSubcomponents("vtimezone");
  const items: ImportItem[] = [];
  const problems: ImportProblem[] = [];
  calendar.getAllSubcomponents("vtodo").forEach((todo, index) => {
    const uidValue = todo.getFirstPropertyValue("uid");
    const uid = typeof uidValue === "string" ? uidValue : null;
    const out = new ICAL.Component(["vcalendar", [], []]);
    out.addPropertyWithValue("version", "2.0");
    out.addPropertyWithValue("prodid", calendar.getFirstPropertyValue("prodid") ?? PRODID);
    for (const tz of timezones) {
      const tzid = tz.getFirstPropertyValue("tzid");
      if (typeof tzid === "string" && usesTzid(todo, tzid)) out.addSubcomponent(new ICAL.Component(tz.toJSON()));
    }
    out.addSubcomponent(new ICAL.Component(todo.toJSON()));
    const ics = `${out.toString()}\r\n`;
    try {
      items.push({ ics, view: readTask(parseResource(ics)) });
    } catch (error) {
      if (!(error instanceof InvalidInputError)) throw error;
      problems.push({
        index,
        uid,
        message: error.message,
        property: String(error.context["property"] ?? ""),
      });
    }
  });
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.view.uid)) {
      throw new InvalidInputError("domain", "Duplicate UID in import file", { property: "UID" });
    }
    seen.add(item.view.uid);
  }
  return { items, problems };
}

function usesTzid(todo: Component, tzid: string): boolean {
  const check = (c: Component): boolean =>
    c.getAllProperties().some((p) => p.getFirstParameter("tzid") === tzid) ||
    c.getAllSubcomponents().some(check);
  return check(todo);
}

/** Joins task resources into one `.ics` file. VTIMEZONEs are deduplicated by TZID. */
export function joinIcsFile(resources: readonly string[]): string {
  const out = new ICAL.Component(["vcalendar", [], []]);
  out.addPropertyWithValue("version", "2.0");
  out.addPropertyWithValue("prodid", PRODID);
  const zones = new Set<string>();
  for (const ics of resources) {
    const { calendar, todo } = parseResource(ics);
    for (const tz of calendar.getAllSubcomponents("vtimezone")) {
      const tzid = tz.getFirstPropertyValue("tzid");
      if (typeof tzid !== "string") throw new HakenError("domain", "VTIMEZONE without TZID");
      if (zones.has(tzid)) continue;
      zones.add(tzid);
      out.addSubcomponent(new ICAL.Component(tz.toJSON()));
    }
    out.addSubcomponent(new ICAL.Component(todo.toJSON()));
  }
  return `${out.toString()}\r\n`;
}
