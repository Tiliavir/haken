import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot, TaskItem } from "../../web/src/app/service.js";
import {
  asLabelEmoji,
  asLabelOrder,
  isEmoji,
  moveLabel,
  relabelEmoji,
  relabelOrder,
  sortLabels,
  withLabelEmoji,
} from "../../web/src/domain/labels.js";
import { createTask, parseResource, readTask, type TaskView } from "../../web/src/domain/vtodo.js";
import { labelCount, labelNames, labelTasks, labelUses } from "../../web/src/ui/views.js";

const NOW = new Date("2026-11-08T10:00:00");
const base = readTask(
  parseResource(
    createTask(
      { uid: "b", summary: "b", sortOrder: 0, parentUid: null, important: false, due: null },
      NOW,
    ),
  ),
);

function item(list: string, uid: string, v: Partial<TaskView>): TaskItem {
  return {
    href: `${list}${uid}.ics`,
    list,
    view: { ...base, uid, summary: uid, ...v },
    invalid: null,
    steps: [],
    conflicts: [],
    pending: false,
    tooLarge: false,
  };
}

function snapshot(): Snapshot {
  const list = (href: string, errorlogs: boolean, tasks: TaskItem[]) => ({
    href,
    name: href,
    color: null,
    errorlogs,
    tasks,
    openCount: tasks.length,
  });
  return {
    account: null,
    settings: {} as Snapshot["settings"],
    lists: [
      list("/a/", false, [
        item("/a/", "a1", { categories: ["Home"], sortOrder: 5 }),
        item("/a/", "a2", { categories: ["work", "Home"], sortOrder: 1 }),
        item("/a/", "a3", { categories: ["Home"], done: true }),
      ]),
      list("/b/", false, [item("/b/", "b1", { categories: ["Home", "10 later"], sortOrder: 3 })]),
      list("/e/", true, [item("/e/", "e1", { categories: ["Errors"] })]),
    ],
    labelOrder: [],
    labelEmoji: new Map(),
    status: { kind: "local" },
    lastSync: null,
    pending: 0,
    quarantined: [],
  };
}

test("labels in use: by name, numbers natural, errorlogs excluded", () => {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  assert.deepEqual(labelNames(snapshot(), collator), ["10 later", "Home", "work"]);
});

const COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

test("label order: ordered labels first, new ones after by name, unused ones ignored", () => {
  const s: Snapshot = { ...snapshot(), labelOrder: ["work", "gone", "10 later"] };
  assert.deepEqual(labelNames(s, COLLATOR), ["work", "10 later", "Home"]);
  assert.deepEqual(sortLabels(["b", "a", "c"], ["c"], COLLATOR), ["c", "a", "b"]);
});

test("label order: a move stores the shown order, clamped to its ends", () => {
  const shown = ["a", "b", "c"];
  assert.deepEqual(moveLabel(shown, "c", 0), ["c", "a", "b"]);
  assert.deepEqual(moveLabel(shown, "a", 1), ["b", "a", "c"]);
  assert.deepEqual(moveLabel(shown, "a", 9), ["b", "c", "a"]);
  assert.throws(() => moveLabel(shown, "x", 0), /Moved label is not shown/);
});

test("label order: rename keeps the place, a merge the first one, delete drops it", () => {
  const order = ["a", "b", "c"];
  const rename = (from: string, to: string) => (n: readonly string[]) =>
    n.map((v) => (v === from ? to : v));
  assert.deepEqual(relabelOrder(order, rename("b", "x")), ["a", "x", "c"]);
  assert.deepEqual(relabelOrder(order, rename("c", "a")), ["a", "b"]);
  assert.deepEqual(relabelOrder(order, rename("a", "c")), ["c", "b"]);
  assert.deepEqual(
    relabelOrder(order, (n) => n.filter((v) => v !== "b")),
    ["a", "c"],
  );
});

test("label order: stored values are validated strictly", () => {
  assert.deepEqual(asLabelOrder(["a", "b"]), ["a", "b"]);
  for (const bad of [null, "a", [1], [""], ["a", "a"], { 0: "a" }]) {
    assert.throws(() => asLabelOrder(bad), /Invalid label order/);
  }
});

test("a label view spans lists: open tasks by sort order, then completed", () => {
  const hrefs = labelTasks(snapshot(), "Home").map((t) => t.view?.uid);
  assert.deepEqual(hrefs, ["a2", "b1", "a1", "a3"]);
  assert.equal(labelCount(snapshot(), "Home"), 3);
  assert.deepEqual(labelTasks(snapshot(), "home"), []);
  assert.deepEqual(labelTasks(snapshot(), "Errors"), []);
});

test("label uses: tasks and steps of user lists, completed included", () => {
  const s = snapshot();
  const first = s.lists[0];
  assert.ok(first);
  const withStep: Snapshot = {
    ...s,
    lists: [
      {
        ...first,
        tasks: first.tasks.map((t, i) =>
          i === 0 ? { ...t, steps: [item("/a/", "s1", { categories: ["Home"] })] } : t,
        ),
      },
      ...s.lists.slice(1),
    ],
  };
  assert.equal(labelUses(withStep, "Home"), 5);
  assert.equal(labelUses(withStep, "Errors"), 0);
});

test("createTask writes labels as CATEGORIES", () => {
  const ics = createTask(
    {
      uid: "c",
      summary: "c",
      sortOrder: 0,
      parentUid: null,
      important: false,
      due: null,
      categories: ["Home", "Home", "Garden, front"],
    },
    NOW,
  );
  assert.deepEqual(readTask(parseResource(ics)).categories, ["Home", "Garden, front"]);
});

test("label emoji: exactly one emoji, flags and ZWJ sequences included", () => {
  for (const ok of ["🌱", "❤️", "👩‍👩‍👧", "🇨🇭", "👍🏽"]) assert.equal(isEmoji(ok), true, ok);
  for (const bad of ["", "a", "🌱🌱", "🌱a", "1", "★ "]) assert.equal(isEmoji(bad), false, bad);
});

test("label emoji: set, remove, rename and delete", () => {
  const start = withLabelEmoji(new Map(), "a", "🌱");
  assert.deepEqual(
    [...withLabelEmoji(start, "b", "🔥")],
    [
      ["a", "🌱"],
      ["b", "🔥"],
    ],
  );
  assert.deepEqual([...withLabelEmoji(start, "a", "")], []);
  assert.throws(() => withLabelEmoji(start, "a", "x"), /Not one emoji/);
  const both = new Map([
    ["a", "🌱"],
    ["b", "🔥"],
  ]);
  const rename = (from: string, to: string) => (n: readonly string[]) =>
    n.map((v) => (v === from ? to : v));
  assert.deepEqual(
    [...relabelEmoji(both, rename("a", "x"))],
    [
      ["b", "🔥"],
      ["x", "🌱"],
    ],
  );
  // Onto a label with its own emoji: that one stays.
  assert.deepEqual([...relabelEmoji(both, rename("a", "b"))], [["b", "🔥"]]);
  assert.deepEqual([...relabelEmoji(both, (n) => n.filter((v) => v !== "a"))], [["b", "🔥"]]);
});

test("label emoji: stored values are validated strictly", () => {
  assert.deepEqual([...asLabelEmoji({ a: "🌱" })], [["a", "🌱"]]);
  for (const bad of [null, [], "a", { a: 1 }, { a: "x" }, { "": "🌱" }]) {
    assert.throws(() => asLabelEmoji(bad), /Invalid label emoji/);
  }
});
