/**
 * Three-way merge of a VTODO per property group
 * ([sync strategy](../../../docs/arc42/adr/ADR-20261103-sync-strategy.md)).
 *
 * The result is built on the server version, so its structure (VTIMEZONEs,
 * unknown properties added by other clients) is kept. Only groups where the
 * local side wins are written over it. Every losing value becomes a
 * conflict note; nothing is dropped.
 */
import ICAL from "../../vendor/ical.js/ical.js";
import { HakenError } from "./errors.js";
import {
  groupLines,
  groupsOf,
  type ParsedResource,
  parseResource,
  readTask,
  replaceGroup,
  serialize,
} from "./vtodo.js";

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
    throw new HakenError("domain", "Merge of different UIDs", { local: lView.uid, server: sView.uid });
  }
  const serverTime = sView.lastModified ?? dtstampOf(s);

  const groups = new Set<string>([...groupsOf(l.todo), ...groupsOf(s.todo)]);
  if (b !== null) for (const g of groupsOf(b.todo)) groups.add(g);

  const notes: ConflictNote[] = [];
  const localWins: string[] = [];
  for (const group of [...groups].sort()) {
    const lv = groupLines(l.todo, group);
    const sv = groupLines(s.todo, group);
    if (lv === sv) continue;
    const bv = b === null ? null : groupLines(b.todo, group);
    if (bv !== null && lv === bv) continue; // only the server changed it
    if (bv !== null && sv === bv) {
      replaceGroup(s.todo, group, lv); // only haken changed it
      localWins.push(group);
      continue;
    }
    const localTime = localEditTimes.get(group) ?? null;
    const localNewer = localTime !== null && serverTime !== null && localTime > serverTime;
    if (localNewer) {
      notes.push({ group, lines: sv, lost: "server" });
      replaceGroup(s.todo, group, lv);
      localWins.push(group);
    } else {
      notes.push({ group, lines: lv, lost: "local" });
    }
  }

  const merged: ParsedResource = s;
  if (localWins.length > 0) {
    const sequence = Math.max(sequenceOf(l), sequenceOf(s));
    if (sequence > 0) merged.todo.updatePropertyWithValue("sequence", sequence);
    const modified = Math.max(lView.lastModified ?? 0, serverTime ?? 0);
    if (modified > 0) {
      merged.todo.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(new Date(modified), true));
    }
  }
  const ics = localWins.length > 0 ? serialize(merged) : server;
  readTask(parseResource(ics));
  return { ics, notes, localWins };
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
