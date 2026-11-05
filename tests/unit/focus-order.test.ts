import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidInputError } from "../../web/src/domain/errors.js";
import { asFocusOrder, focusRank } from "../../web/src/domain/focus.js";
import { reorder } from "../../web/src/domain/order.js";
import {
  applyEdit,
  createTask,
  parseResource,
  readTask,
  type TaskView,
} from "../../web/src/domain/vtodo.js";

const NOW = new Date("2026-11-05T10:00:00");
const view = (ics: string) => readTask(parseResource(ics));

function task(uid: string, extra: Partial<TaskView>): TaskView {
  const base = view(
    createTask(
      { uid, summary: uid, sortOrder: 1, parentUid: null, important: false, due: null },
      NOW,
    ),
  );
  return { ...base, ...extra };
}

test("defaults: due part by due date, picked part newest first", () => {
  const a = task("a", { due: { kind: "date", date: "2026-11-01" } });
  const b = task("b", { due: { kind: "date", date: "2026-11-03" } });
  assert.ok(focusRank(a, "due") < focusRank(b, "due"));
  const old = task("old", { focus: "2026-10-01" });
  const recent = task("recent", { focus: "2026-11-04" });
  assert.deepEqual(
    asFocusOrder([old, recent], "picked").map((t) => t.uid),
    ["recent", "old"],
  );
});

test("a move writes one order between the neighbours' effective values", () => {
  const parts = ["2026-11-04", "2026-11-03", "2026-11-02"].map((d, i) =>
    task(`p${i}`, { focus: d }),
  );
  const views = asFocusOrder(parts, "picked");
  const moves = reorder(views, "p2", 0);
  assert.equal(moves.length, 1);
  const moved = { ...parts[2], focusOrder: moves[0]?.sortOrder ?? 0 } as TaskView;
  assert.deepEqual(
    asFocusOrder([parts[0] as TaskView, parts[1] as TaskView, moved], "picked").map((t) => t.uid),
    ["p2", "p0", "p1"],
  );
});

test("X-HAKEN-FOCUS-ORDER: written as an integer, removed with Focus, strict on read", () => {
  const base = createTask(
    {
      uid: "x",
      summary: "x",
      sortOrder: 1,
      parentUid: null,
      important: false,
      due: null,
      focus: "2026-11-05",
    },
    NOW,
  );
  const ordered = applyEdit(base, { kind: "focusOrder", value: -42 }, NOW);
  assert.deepEqual(ordered.groups, ["X-HAKEN-FOCUS-ORDER"]);
  assert.match(ordered.ics, /X-HAKEN-FOCUS-ORDER:-42\r\n/);
  assert.equal(view(ordered.ics).focusOrder, -42);
  const off = applyEdit(ordered.ics, { kind: "focus", value: null }, NOW);
  assert.deepEqual([...off.groups].sort(), ["X-HAKEN-FOCUS", "X-HAKEN-FOCUS-ORDER"]);
  assert.equal(view(off.ics).focusOrder, null);
  assert.throws(
    () => view(base.replace("END:VTODO", "X-HAKEN-FOCUS-ORDER:1.5\r\nEND:VTODO")),
    InvalidInputError,
  );
});
