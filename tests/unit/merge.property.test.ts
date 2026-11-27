import assert from "node:assert/strict";
import { test } from "node:test";
import { merge } from "../../web/src/domain/merge.js";
import {
  applyEdit,
  createTask,
  groupLines,
  groupsOf,
  parseResource,
  readTask,
  type TaskEdit,
  UNMERGED,
} from "../../web/src/domain/vtodo.js";
import { forAll, type Rng } from "./property.js";

const T0 = Date.parse("2026-11-01T10:00:00Z");
const LABELS = ["a", "b", "c,d", "ä ö", "x;y", "back\\slash"];
const TEXT = 'ab ,;:\\"äé€😀\n';

function randomEdit(rng: Rng): TaskEdit {
  switch (rng.int(0, 6)) {
    case 0:
      return { kind: "summary", value: rng.string(TEXT, 12) };
    case 1:
      return { kind: "description", value: rng.string(TEXT, 30) };
    case 2:
      return { kind: "done", value: rng.bool() };
    case 3:
      return { kind: "important", value: rng.bool() };
    case 4:
      return { kind: "categories", value: rng.subset(LABELS) };
    case 5:
      return { kind: "sortOrder", value: rng.int(-5, 5) };
    default:
      return {
        kind: "due",
        value: rng.bool() ? null : { kind: "date", date: `2026-12-${rng.int(10, 28)}` },
      };
  }
}

interface Side {
  readonly ics: string;
  readonly times: Map<string, number>;
}

function edited(rng: Rng, from: string, start: number): Side {
  let ics = from;
  const times = new Map<string, number>();
  for (let i = rng.int(0, 4), t = start; i > 0; i--, t += 60_000) {
    const r = applyEdit(ics, randomEdit(rng), new Date(t));
    ics = r.ics;
    for (const g of r.groups) times.set(g, t);
  }
  return { ics, times };
}

function generate(rng: Rng) {
  const base = createTask(
    {
      uid: "p-1",
      summary: rng.string(TEXT, 8),
      sortOrder: 0,
      parentUid: null,
      important: rng.bool(),
      due: null,
      categories: rng.subset(LABELS),
    },
    new Date(T0),
  );
  // Either side may be the newer one.
  const local = edited(rng, base, T0 + rng.int(1, 100) * 60_000);
  const server = edited(rng, base, T0 + rng.int(1, 100) * 60_000);
  return { base, local, server };
}

const todo = (ics: string) => parseResource(ics).todo;
const contentGroups = (...ics: string[]) =>
  [...new Set(ics.flatMap((x) => [...groupsOf(todo(x))]))].filter(
    (g) => !UNMERGED.has(g.toLowerCase()),
  );
const labels = (ics: string) => new Set(readTask(parseResource(ics)).categories);

test("merge: identical sides, or one side unchanged, take that side as is", () => {
  forAll(generate, ({ base, local, server }) => {
    const same = merge(base, local.ics, local.ics, local.times);
    assert.equal(same.ics, local.ics);
    assert.deepEqual(same.notes, []);
    const onlyServer = merge(base, base, server.ics, new Map());
    assert.equal(onlyServer.ics, server.ics);
    assert.deepEqual(onlyServer.notes, []);
    const onlyLocal = merge(base, local.ics, base, local.times);
    assert.deepEqual(onlyLocal.notes, []);
    for (const g of contentGroups(local.ics, base))
      assert.equal(groupLines(todo(onlyLocal.ics), g), groupLines(todo(local.ics), g), g);
  });
});

test("merge: no value is lost — each group is one side's value, the other side's is a note", () => {
  forAll(generate, ({ base, local, server }) => {
    const r = merge(base, local.ics, server.ics, local.times);
    const notes = new Map(r.notes.map((n) => [n.group, n]));
    assert.equal(notes.size, r.notes.length, "one note per group");
    for (const g of contentGroups(base, local.ics, server.ics)) {
      const [b, l, s, out] = [base, local.ics, server.ics, r.ics].map((x) =>
        groupLines(todo(x), g),
      );
      if (g === "CATEGORIES") continue;
      const note = notes.get(g);
      if (l === s || l === b || s === b) {
        assert.equal(note, undefined, `${g}: note without a conflict`);
        assert.equal(out, l === b ? s : l, g);
      } else if (out === l) {
        assert.deepEqual(note, { group: g, lines: s, lost: "server" }, g);
      } else {
        assert.equal(out, s, g);
        assert.deepEqual(note, { group: g, lines: l, lost: "local" }, g);
      }
    }
  });
});

test("merge: labels are (server ∪ added) − removed", () => {
  forAll(generate, ({ base, local, server }) => {
    const r = merge(base, local.ics, server.ics, local.times);
    const [b, l, s] = [base, local.ics, server.ics].map(labels) as [
      Set<string>,
      Set<string>,
      Set<string>,
    ];
    const expected = new Set(
      [...s, ...[...l].filter((x) => !b.has(x))].filter((x) => l.has(x) || !b.has(x)),
    );
    assert.deepEqual(labels(r.ics), expected);
    assert.equal(r.notes.filter((n) => n.group === "CATEGORIES").length, 0);
  });
});
