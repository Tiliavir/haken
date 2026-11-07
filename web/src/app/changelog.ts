/** The released versions from `changelog.json` (built from CHANGELOG.md), for *What's new*. */
import { InvalidInputError } from "../domain/errors.js";
import { staticJson } from "../net/http.js";

export interface ChangelogSection {
  readonly title: string;
  readonly items: readonly string[];
}

export interface ChangelogEntry {
  readonly version: string;
  readonly date: string;
  readonly summary: string;
  readonly sections: readonly ChangelogSection[];
}

const PATH = "changelog.json";
const VERSION = /^\d+\.\d+\.\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function invalid(key: string): InvalidInputError {
  return new InvalidInputError("app", "Changelog has an unexpected shape", { path: PATH, key });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStrings(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((s) => typeof s === "string" && s !== "");
}

function toSection(v: unknown, key: string): ChangelogSection {
  if (!isRecord(v) || typeof v["title"] !== "string" || v["title"] === "" || !isStrings(v["items"]))
    throw invalid(key);
  return { title: v["title"], items: v["items"] };
}

function toEntry(v: unknown, index: number): ChangelogEntry {
  const key = `[${index}]`;
  if (!isRecord(v)) throw invalid(key);
  const { version, date, summary, sections } = v;
  if (typeof version !== "string" || !VERSION.test(version)) throw invalid(`${key}.version`);
  if (typeof date !== "string" || !DATE.test(date)) throw invalid(`${key}.date`);
  if (typeof summary !== "string") throw invalid(`${key}.summary`);
  if (!Array.isArray(sections)) throw invalid(`${key}.sections`);
  return {
    version,
    date,
    summary,
    sections: sections.map((s, i) => toSection(s, `${key}.sections[${i}]`)),
  };
}

/** Validates the parsed `changelog.json`; anything unexpected throws. */
export function parseChangelog(value: unknown): ChangelogEntry[] {
  if (!Array.isArray(value)) throw invalid("root");
  return value.map((entry, index) => toEntry(entry, index));
}

/** Orders `x.y.z` versions numerically. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * The entries to show after an update from `seen` to `current`, newest first:
 * every version after `seen` up to `current`; only `current` when `seen` is
 * unknown (`null`, installed before haken remembered it). `current` must be in
 * the changelog: the build guarantees it.
 */
export function unseen(
  entries: readonly ChangelogEntry[],
  seen: string | null,
  current: string,
): ChangelogEntry[] {
  if (!entries.some((e) => e.version === current))
    throw new InvalidInputError("app", "Changelog has no entry for this version", {
      path: PATH,
      key: current,
    });
  return entries
    .filter((e) =>
      seen === null
        ? e.version === current
        : compareVersions(e.version, seen) > 0 && compareVersions(e.version, current) <= 0,
    )
    .toSorted((a, b) => compareVersions(b.version, a.version));
}

export async function loadChangelog(): Promise<ChangelogEntry[]> {
  return parseChangelog(await staticJson(PATH));
}
