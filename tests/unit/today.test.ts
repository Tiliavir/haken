import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Snapshot, TaskItem } from "../../web/src/app/service.js";
import { InvalidInputError } from "../../web/src/domain/errors.js";
import {
  applyEdit,
  createTask,
  parseResource,
  readTask,
  type TaskView,
} from "../../web/src/domain/vtodo.js";
import { todayTasks } from "../../web/src/ui/views.js";

const NOW = new Date("2026-11-04T10:00:00");
const base = createTask(
  { uid: "t-1", summary: "x", sortOrder: 1, parentUid: null, important: false, due: null },
  NOW,
);

describe("X-HAKEN-MYDAY", () => {
  test("put on Today, keep the first day, take off", () => {
    const on = applyEdit(base, { kind: "today", value: "2026-11-04" }, NOW);
    assert.deepEqual(on.groups, ["X-HAKEN-MYDAY"]);
    assert.match(on.ics, /X-HAKEN-MYDAY:20261104\r\n/);
    assert.equal(readTask(parseResource(on.ics)).today, "2026-11-04");
    // Adding again on a later day does not reset it: it stays from the first day.
    assert.deepEqual(applyEdit(on.ics, { kind: "today", value: "2026-11-09" }, NOW).groups, []);
    const off = applyEdit(on.ics, { kind: "today", value: null }, NOW);
    assert.equal(readTask(parseResource(off.ics)).today, null);
    assert.doesNotMatch(off.ics, /X-HAKEN-MYDAY/);
  });
  test("createTask can put a task on Today", () => {
    const ics = createTask(
      {
        uid: "t-2",
        summary: "y",
        sortOrder: 1,
        parentUid: null,
        important: false,
        due: null,
        today: "2026-11-04",
      },
      NOW,
    );
    assert.equal(readTask(parseResource(ics)).today, "2026-11-04");
  });
  test("an invalid value is invalid input", () => {
    for (const value of ["2026-11-04", "20261345", "yes"]) {
      const ics = base.replace("END:VTODO", `X-HAKEN-MYDAY:${value}\r\nEND:VTODO`);
      assert.throws(() => readTask(parseResource(ics)), InvalidInputError, value);
    }
  });
});

function item(uid: string, v: Partial<TaskView>): TaskItem {
  const view = { ...readTask(parseResource(base)), uid, summary: uid, ...v } as TaskView;
  return {
    href: `/l/${uid}.ics`,
    list: "/l/",
    view,
    invalid: null,
    steps: [],
    conflicts: [],
    pending: false,
    tooLarge: false,
  };
}

function snapshot(tasks: TaskItem[]): Snapshot {
  return {
    account: null,
    settings: {} as Snapshot["settings"],
    lists: [
      { href: "/l/", name: "L", color: null, errorlogs: false, tasks, openCount: tasks.length },
      {
        href: "/e/",
        name: "errorlogs",
        color: null,
        errorlogs: true,
        tasks: [item("err", { due: { kind: "date", date: "2026-11-01" } })],
        openCount: 1,
      },
    ],
    status: { kind: "local" },
    lastSync: null,
    pending: 0,
  };
}

test("Today: overdue and due first, then pinned tasks (newest first), never reset", () => {
  const done = new Date("2026-11-04T08:00:00").getTime();
  const tasks = [
    item("pinned-old", { today: "2026-10-01" }),
    item("due-today", { due: { kind: "date", date: "2026-11-04" } }),
    item("not-today", {}),
    item("pinned-new", { today: "2026-11-03" }),
    item("overdue", { due: { kind: "date", date: "2026-11-02" } }),
    item("due-and-pinned", { due: { kind: "date", date: "2026-11-04" }, today: "2026-11-04" }),
    item("future-pinned", { due: { kind: "date", date: "2026-11-20" }, today: "2026-11-02" }),
    item("done-today", { done: true, completedAt: done, today: "2026-11-01" }),
    item("done-earlier", { done: true, completedAt: done - 3 * 86_400_000, today: "2026-11-01" }),
  ];
  assert.deepEqual(
    todayTasks(snapshot(tasks), NOW.getTime()).map((t) => t.view?.uid),
    [
      "overdue",
      "due-today",
      "due-and-pinned",
      "pinned-new",
      "future-pinned",
      "pinned-old",
      "done-today",
    ],
  );
});
