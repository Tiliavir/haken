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
import { focusTasks } from "../../web/src/ui/views.js";

const NOW = new Date("2026-11-04T10:00:00");
const base = createTask(
  { uid: "t-1", summary: "x", sortOrder: 1, parentUid: null, important: false, due: null },
  NOW,
);

describe("X-HAKEN-FOCUS", () => {
  test("put on Focus, keep the first day, take off", () => {
    const on = applyEdit(base, { kind: "focus", value: "2026-11-04" }, NOW);
    assert.deepEqual(on.groups, ["X-HAKEN-FOCUS"]);
    assert.match(on.ics, /X-HAKEN-FOCUS:20261104\r\n/);
    assert.equal(readTask(parseResource(on.ics)).focus, "2026-11-04");
    // Adding again on a later day does not reset it: it stays from the first day.
    assert.deepEqual(applyEdit(on.ics, { kind: "focus", value: "2026-11-09" }, NOW).groups, []);
    const off = applyEdit(on.ics, { kind: "focus", value: null }, NOW);
    assert.equal(readTask(parseResource(off.ics)).focus, null);
    assert.doesNotMatch(off.ics, /X-HAKEN-FOCUS/);
  });
  test("createTask can put a task on Focus", () => {
    const ics = createTask(
      {
        uid: "t-2",
        summary: "y",
        sortOrder: 1,
        parentUid: null,
        important: false,
        due: null,
        focus: "2026-11-04",
      },
      NOW,
    );
    assert.equal(readTask(parseResource(ics)).focus, "2026-11-04");
  });
  test("an invalid value is invalid input", () => {
    for (const value of ["2026-11-04", "20261345", "yes"]) {
      const ics = base.replace("END:VTODO", `X-HAKEN-FOCUS:${value}\r\nEND:VTODO`);
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

test("Focus: overdue and due first, then pinned tasks (newest first), never reset", () => {
  const done = new Date("2026-11-04T08:00:00").getTime();
  const tasks = [
    item("pinned-old", { focus: "2026-10-01" }),
    item("due-today", { due: { kind: "date", date: "2026-11-04" } }),
    item("not-on-focus", {}),
    item("pinned-new", { focus: "2026-11-03" }),
    item("overdue", { due: { kind: "date", date: "2026-11-02" } }),
    item("due-and-pinned", { due: { kind: "date", date: "2026-11-04" }, focus: "2026-11-04" }),
    item("future-pinned", { due: { kind: "date", date: "2026-11-20" }, focus: "2026-11-02" }),
    item("done-today", { done: true, completedAt: done, focus: "2026-11-01" }),
    item("done-earlier", { done: true, completedAt: done - 3 * 86_400_000, focus: "2026-11-01" }),
  ];
  assert.deepEqual(
    focusTasks(snapshot(tasks), NOW.getTime()).map((t) => t.view?.uid),
    [
      "overdue",
      "due-and-pinned",
      "due-today",
      "pinned-new",
      "future-pinned",
      "pinned-old",
      "done-today",
    ],
  );
});
