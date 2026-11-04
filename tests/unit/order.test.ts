import assert from "node:assert/strict";
import { test } from "node:test";
import { compareTasks, orderAtEnd, orderOnTop, reorder } from "../../web/src/domain/order.js";
import type { TaskView } from "../../web/src/domain/vtodo.js";

const task = (uid: string, sortOrder: number): TaskView => ({
  uid,
  summary: "",
  description: "",
  status: "NEEDS-ACTION",
  done: false,
  completedAt: null,
  important: false,
  due: null,
  categories: [],
  sortOrder,
  parentUid: null,
  attachments: [],
  created: null,
  lastModified: null,
  repeats: false,
  prodid: null,
});

test("compare by order, then UID", () => {
  const list = [task("b", 2), task("c", 1), task("a", 2)].sort(compareTasks);
  assert.deepEqual(
    list.map((t) => t.uid),
    ["c", "a", "b"],
  );
});
test("top and end", () => {
  assert.equal(orderOnTop([task("a", 5), task("b", 9)], 0), 4);
  assert.equal(orderAtEnd([task("a", 5), task("b", 9)], 0), 10);
  assert.equal(orderOnTop([], 42), 42);
});
test("move into a gap writes one task", () => {
  const list = [task("a", 0), task("b", 10), task("c", 20)];
  assert.deepEqual(reorder(list, "c", 1), [{ uid: "c", sortOrder: 5 }]);
  assert.deepEqual(reorder(list, "a", 2), [{ uid: "a", sortOrder: 21 }]);
  assert.deepEqual(reorder(list, "c", 0), [{ uid: "c", sortOrder: -1 }]);
});
test("move without a gap shifts only as far as needed", () => {
  const list = [task("a", 1), task("b", 2), task("c", 3), task("d", 10)];
  assert.deepEqual(reorder(list, "d", 1), [
    { uid: "d", sortOrder: 2 },
    { uid: "b", sortOrder: 3 },
    { uid: "c", sortOrder: 4 },
  ]);
});
test("unknown task throws", () => {
  assert.throws(() => reorder([task("a", 1)], "x", 0));
});
