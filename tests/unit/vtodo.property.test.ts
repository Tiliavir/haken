import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidInputError } from "../../web/src/domain/errors.js";
import { joinIcsFile, splitIcsFile } from "../../web/src/domain/icsfile.js";
import { parseResource, readTask, serialize } from "../../web/src/domain/vtodo.js";
import { canonical, fixture } from "./helpers.js";
import { forAll, type Rng } from "./property.js";

const VALID = [
  "apple-completed.ics",
  "haken-attachment.ics",
  "recurring-bymonthday.ics",
  "recurring-count.ics",
  "repeating.ics",
  "tasksorg-recurring.ics",
  "tasksorg-subtask.ics",
  "thunderbird-recurring-tzid.ics",
  "thunderbird-tzid.ics",
].map(fixture);
const NOISE = ':;=,"\\\r\n \t0123456789TZ-+äBEGINENDVTODOUIDDUESTATUSRRULE';

/** Small structural or byte-level change, the way a sloppy client or a broken transfer would make it. */
function mutate(rng: Rng, ics: string): string {
  const lines = ics.split("\r\n");
  for (let n = rng.int(1, 3); n > 0; n--) {
    const i = rng.int(0, lines.length - 1);
    const line = lines[i] ?? "";
    const at = rng.int(0, line.length);
    switch (rng.int(0, 4)) {
      case 0:
        lines.splice(i, 1);
        break;
      case 1:
        lines.splice(i, 0, line);
        break;
      case 2:
        lines[i] = line.slice(0, at) + rng.string(NOISE, 4) + line.slice(at);
        break;
      case 3:
        lines[i] = line.slice(0, at);
        break;
      default:
        lines.splice(i, 0, lines.splice(rng.int(0, lines.length - 1), 1)[0] ?? "");
    }
  }
  return lines.join("\r\n");
}

/** Accepted input must read the same after a round-trip; rejected input must say why. */
function strictRead(ics: string): void {
  let first: string;
  try {
    const view = readTask(parseResource(ics));
    first = serialize(parseResource(ics));
    assert.deepEqual(readTask(parseResource(first)), view);
  } catch (error) {
    if (error instanceof InvalidInputError) return;
    throw error;
  }
  assert.equal(serialize(parseResource(first)), first);
}

test("parser: mutated real-world tasks are read and round-tripped, or rejected as invalid input", () => {
  forAll((rng) => mutate(rng, rng.pick(VALID)), strictRead, 1000);
});

test("import: split(join(tasks)) returns every task unchanged", () => {
  forAll(
    (rng) => rng.subset(VALID),
    (tasks) => {
      const { items, problems } = splitIcsFile(joinIcsFile(tasks));
      assert.deepEqual(problems, []);
      assert.equal(items.length, tasks.length);
      items.forEach((item, i) => {
        // One file holds one VTIMEZONE per TZID, so only the task itself must come back unchanged.
        const original = [...canonical(tasks[i] ?? "")].filter((l) =>
          l.startsWith("vcalendar/vtodo"),
        );
        const out = canonical(item.ics);
        for (const line of original) assert.ok(out.has(line), `lost: ${line}`);
      });
    },
  );
});

test("import: a mutated file is split or rejected as invalid input, never half-read", () => {
  forAll(
    (rng) => mutate(rng, joinIcsFile(rng.subset(VALID))),
    (text) => {
      try {
        const { items, problems } = splitIcsFile(text);
        const todos = text.match(/^BEGIN:VTODO\r?$/gim)?.length ?? 0;
        assert.ok(items.length + problems.length <= todos);
        for (const item of items) strictRead(item.ics);
      } catch (error) {
        if (!(error instanceof InvalidInputError)) throw error;
      }
    },
    500,
  );
});
