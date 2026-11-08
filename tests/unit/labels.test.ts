import assert from "node:assert/strict";
import { test } from "node:test";
import type { Snapshot, TaskItem } from "../../web/src/app/service.js";
import { createTask, parseResource, readTask, type TaskView } from "../../web/src/domain/vtodo.js";
import { labelCount, labelNames, labelTasks } from "../../web/src/ui/views.js";

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
    status: { kind: "local" },
    lastSync: null,
    pending: 0,
  };
}

test("labels in use: by name, numbers natural, errorlogs excluded", () => {
  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });
  assert.deepEqual(labelNames(snapshot(), collator), ["10 later", "Home", "work"]);
});

test("a label view spans lists: open tasks by sort order, then completed", () => {
  const hrefs = labelTasks(snapshot(), "Home").map((t) => t.view?.uid);
  assert.deepEqual(hrefs, ["a2", "b1", "a1", "a3"]);
  assert.equal(labelCount(snapshot(), "Home"), 3);
  assert.deepEqual(labelTasks(snapshot(), "home"), []);
  assert.deepEqual(labelTasks(snapshot(), "Errors"), []);
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
