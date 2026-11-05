/**
 * Three-way merge of a VTODO per property group
 * ([sync strategy](../../../docs/arc42/adr/ADR-20261103-sync-strategy.md)).
 *
 * The result is built on the server version, so its structure (VTIMEZONEs,
 * unknown properties added by other clients) is kept. Only groups where the
 * local side wins are written over it. Every losing value becomes a
 * conflict note; nothing is dropped. Labels and attachments are sets and
 * merge without notes ([set merge](../../../docs/arc42/adr/ADR-20261104-set-merge.md)).
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { byCodeUnit } from "./compare.js";
import { HakenError } from "./errors.js";
import {
  type Component,
  groupLines,
  groupsOf,
  type ParsedResource,
  type Property,
  parseResource,
  readTask,
  replaceGroup,
  serialize,
} from "./vtodo.js";

/** Groups merged as sets: result = (server ∪ added) − removed; no conflict note. */
const SET_GROUPS: ReadonlySet<string> = new Set(["CATEGORIES", "ATTACH"]);

export interface ConflictNote {
  readonly group: string;
  /** Serialized property lines of the losing side; empty means "the group was absent". */
  readonly lines: string;
  /** Which side's value was overwritten. */
  readonly lost: "local" | "server";
}

export interface MergeResult {
  readonly ics: string;
  readonly notes: readonly ConflictNote[];
  /** Groups for which the local value was taken over the server's. */
  readonly localWins: readonly string[];
}

/**
 * @param base the last server version haken saw (merge base); `null` when the
 *   task was created locally and never confirmed by the server.
 * @param localEditTimes per group, the time (ms, UTC) of the newest local edit
 *   from the outbox.
 */
export function merge(
  base: string | null,
  local: string,
  server: string,
  localEditTimes: ReadonlyMap<string, number>,
): MergeResult {
  const l = parseResource(local);
  const s = parseResource(server);
  const b = base === null ? null : parseResource(base);
  const lView = readTask(l);
  const sView = readTask(s);
  if (lView.uid !== sView.uid) {
    throw new HakenError("domain", "Merge of different UIDs", {
      local: lView.uid,
      server: sView.uid,
    });
  }
  const serverTime = sView.lastModified ?? dtstampOf(s);

  const groups = new Set<string>([...groupsOf(l.todo), ...groupsOf(s.todo)]);
  if (b !== null) for (const g of groupsOf(b.todo)) groups.add(g);

  const sides: Sides = { b, l, s, serverTime, localEditTimes };
  const notes: ConflictNote[] = [];
  const localWins: string[] = [];
  for (const group of [...groups].sort(byCodeUnit)) {
    const result = mergeGroup(group, sides);
    if (result.note !== null) notes.push(result.note);
    if (result.localWins) localWins.push(group);
  }

  const merged: ParsedResource = s;
  if (localWins.length > 0) stampMerged(merged, l, lView.lastModified, serverTime);
  const ics = localWins.length > 0 ? serialize(merged) : server;
  readTask(parseResource(ics));
  return { ics, notes, localWins };
}

interface Sides {
  readonly b: ParsedResource | null;
  readonly l: ParsedResource;
  /** Modified in place: the merge result is built on the server version. */
  readonly s: ParsedResource;
  readonly serverTime: number | null;
  readonly localEditTimes: ReadonlyMap<string, number>;
}

/** Merges one property group into the server version. */
function mergeGroup(
  group: string,
  { b, l, s, serverTime, localEditTimes }: Sides,
): { readonly note: ConflictNote | null; readonly localWins: boolean } {
  const lv = groupLines(l.todo, group);
  const sv = groupLines(s.todo, group);
  const unchanged = { note: null, localWins: false };
  if (lv === sv) return unchanged;
  const bv = b === null ? null : groupLines(b.todo, group);
  if (bv !== null && lv === bv) return unchanged; // only the server changed it
  if (bv !== null && sv === bv) {
    replaceGroup(s.todo, group, lv); // only haken changed it
    return { note: null, localWins: true };
  }
  if (SET_GROUPS.has(group))
    return { note: null, localWins: mergeSet(group, b === null ? null : b.todo, l.todo, s.todo) };
  const localTime = localEditTimes.get(group) ?? null;
  const localNewer = localTime !== null && serverTime !== null && localTime > serverTime;
  if (!localNewer) return { note: { group, lines: lv, lost: "local" }, localWins: false };
  replaceGroup(s.todo, group, lv);
  return { note: { group, lines: sv, lost: "server" }, localWins: true };
}

/** `SEQUENCE` and `LAST-MODIFIED` of a merge that took local values: the newer of both sides. */
function stampMerged(
  merged: ParsedResource,
  l: ParsedResource,
  localModified: number | null,
  serverTime: number | null,
): void {
  const sequence = Math.max(sequenceOf(l), sequenceOf(merged));
  if (sequence > 0) merged.todo.updatePropertyWithValue("sequence", sequence);
  const modified = Math.max(localModified ?? 0, serverTime ?? 0);
  if (modified > 0) {
    merged.todo.updatePropertyWithValue(
      "last-modified",
      ICAL.Time.fromJSDate(new Date(modified), true),
    );
  }
}

/**
 * Applies the local additions and removals (against the base; no base: all
 * local items are additions) to the server's set. Returns whether the server
 * version changed.
 */
function mergeSet(
  group: string,
  base: Component | null,
  local: Component,
  server: Component,
): boolean {
  const before = groupLines(server, group);
  if (group === "ATTACH") mergeAttachments(base, local, server);
  else if (group === "CATEGORIES") mergeCategories(base, local, server);
  else throw new HakenError("domain", "No set merge for group", { group });
  return groupLines(server, group) !== before;
}

/** An attachment is identified by its whole property: value and parameters. */
function mergeAttachments(base: Component | null, local: Component, server: Component): void {
  const key = (p: Property) => p.toICALString();
  const baseKeys = new Set(base === null ? [] : base.getAllProperties("attach").map(key));
  const localProps = local.getAllProperties("attach");
  const localKeys = new Set(localProps.map(key));
  const serverKeys = new Set<string>();
  for (const prop of server.getAllProperties("attach")) {
    const k = key(prop);
    if (baseKeys.has(k) && !localKeys.has(k)) server.removeProperty(prop);
    else serverKeys.add(k);
  }
  for (const prop of localProps) {
    const k = key(prop);
    if (baseKeys.has(k) || serverKeys.has(k)) continue;
    server.addProperty(new ICAL.Property(prop.toJSON(), server));
    serverKeys.add(k);
  }
}

/**
 * A label is one value; it may sit in any `CATEGORIES` property. Removed
 * labels are taken out of the server's properties (parameters kept, emptied
 * properties dropped); added labels go into the first server property without
 * parameters, else into a new one.
 */
function mergeCategories(base: Component | null, local: Component, server: Component): void {
  const baseLabels = new Set(base === null ? [] : categoryValues(base));
  const localLabels = new Set(categoryValues(local));
  const removed = new Set([...baseLabels].filter((v) => !localLabels.has(v)));
  const present = new Set<string>();
  for (const prop of server.getAllProperties("categories")) {
    const kept = valuesOf(prop).filter((v) => !removed.has(v));
    if (kept.length === 0) server.removeProperty(prop);
    else if (kept.length !== prop.getValues().length) prop.setValues(kept);
    for (const v of kept) present.add(v);
  }
  const added = [...localLabels].filter((v) => !baseLabels.has(v) && !present.has(v));
  if (added.length === 0) return;
  const target = server
    .getAllProperties("categories")
    .find((p) => Object.keys(p.toJSON()[1]).length === 0);
  if (target === undefined) {
    const prop = new ICAL.Property("categories", server);
    prop.setValues(added);
    server.addProperty(prop);
  } else {
    target.setValues([...valuesOf(target), ...added]);
  }
}

function categoryValues(todo: Component): string[] {
  return todo.getAllProperties("categories").flatMap(valuesOf);
}

function valuesOf(prop: Property): string[] {
  return prop.getValues().map((v) => {
    if (typeof v !== "string") throw new HakenError("domain", "CATEGORIES value is not text");
    return v;
  });
}

function dtstampOf(r: ParsedResource): number | null {
  const value = r.todo.getFirstPropertyValue("dtstamp");
  if (value === null || typeof value === "string") return null;
  if (!("toUnixTime" in value)) return null;
  return value.toUnixTime() * 1000;
}

function sequenceOf(r: ParsedResource): number {
  const value = r.todo.getFirstPropertyValue("sequence");
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}
