import { readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = process.cwd();

export function fixture(name: string): string {
  return readFileSync(join(ROOT, "tests", "fixtures", "vtodo", name), "utf8");
}

/** Unfolded content lines, for comparing what other clients wrote with what haken writes back. */
export function lines(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .split("\r\n")
    .filter((l) => l !== "");
}

import ICAL from "../../web/vendor/ical.js/ical.js";

type Jcal = [string, Record<string, unknown>, string, ...unknown[]];

/**
 * Canonical form of every property in every component: name, parameters
 * (order-insensitive), value type and values. Two resources with equal sets
 * are semantically equal, regardless of parameter order, line folding or a
 * `VALUE=` parameter that only restates the default.
 */
export function canonical(ics: string): Set<string> {
  const out = new Set<string>();
  const walk = (comp: InstanceType<typeof ICAL.Component>, path: string): void => {
    for (const prop of comp.getAllProperties()) {
      const [name, params, type, ...values] = prop.toJSON() as Jcal;
      const sorted = Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));
      out.add(`${path}/${JSON.stringify([name, sorted, type, values])}`);
    }
    for (const sub of comp.getAllSubcomponents()) walk(sub, `${path}/${sub.name}`);
  };
  walk(new ICAL.Component(ICAL.parse(ics)), "vcalendar");
  return out;
}
