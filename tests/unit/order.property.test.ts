import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTasks, reorder } from "../../web/src/domain/order.js";
import type { TaskView } from "../../web/src/domain/vtodo.js";
import { forAll } from "./property.js";

const task = (uid: string, sortOrder: number) => ({ uid, sortOrder }) as TaskView;

test("reorder: the moved task lands at the target, all others keep their relative order", () => {
  forAll(
    (rng) => {
      const n = rng.int(1, 12);
      // Small order range: forces equal values and missing gaps.
      const list = Array.from({ length: n }, (_, i) => task(`t${i}`, rng.int(-3, 3))).sort(
        compareTasks,
      );
      return { list, moved: rng.pick(list).uid, target: rng.int(-2, n + 2) };
    },
    ({ list, moved, target }) => {
      const changes = new Map(reorder(list, moved, target).map((c) => [c.uid, c.sortOrder]));
      const after = list
        .map((t) => task(t.uid, changes.get(t.uid) ?? t.sortOrder))
        .sort(compareTasks)
        .map((t) => t.uid);
      const rest = list.map((t) => t.uid).filter((uid) => uid !== moved);
      const index = Math.max(0, Math.min(target, rest.length));
      const expected = [...rest.slice(0, index), moved, ...rest.slice(index)];
      assert.deepEqual(after, expected);
      for (const value of changes.values()) assert.ok(Number.isSafeInteger(value));
    },
    500,
  );
});
