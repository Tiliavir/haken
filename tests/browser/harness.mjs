// Page side of the browser unit tests: the built modules from dist/web and
// a few helpers that act like the app (local edits with outbox entries).
import {
  applyEdit,
  createTask,
  parseResource,
  readTask,
  resourceGroups,
} from "/src/domain/vtodo.js";
import { AccountStore, StaleError } from "/src/store/account.js";
import { request, transact } from "/src/store/idb.js";
import { SCHEMA } from "/src/store/records.js";
import { QUARANTINE, SyncRunner } from "/src/sync/runner.js";

export { request, SCHEMA, StaleError, transact };

export const LIST = "/dav/u/l1/";
export const store = await AccountStore.open("test");
export const events = { invalid: [], quarantined: [], notices: [] };

// Optional hook after the next read of one task: simulates a user edit landing between
// sync's read and its commit.
let afterRead = null;
const read = store.task.bind(store);
store.task = async (href) => {
  const record = await read(href);
  const hook = afterRead;
  if (hook !== null && hook.href === href) {
    afterRead = null;
    await hook.run();
  }
  return record;
};

export function editAfterNextRead(href, edit) {
  afterRead = { href, run: () => editTask(href, edit) };
}

export function sync() {
  return new SyncRunner(store, "u", {
    onInvalid: async (info) => {
      events.invalid.push(info.href);
    },
    onQuarantine: async (info) => {
      events.quarantined.push({ href: info.href, message: String(info.error?.message) });
    },
    onNotice: (notice) => events.notices.push(notice),
    onChange: () => {},
  }).run();
}

export function newIcs(uid, summary) {
  return createTask(
    { uid, summary, sortOrder: 0, parentUid: null, important: false, due: null },
    new Date(),
  );
}

/** Creates a task locally, as the app does: record and outbox entry in one commit. */
export async function addTask(uid, summary, list = LIST) {
  const ics = newIcs(uid, summary);
  const href = `${list}${uid}.ics`;
  await store.commit({
    putTasks: [{ schema: SCHEMA, href, list, uid, ics, etag: null, deleted: false, invalid: null }],
    addOps: [{ kind: "put", href, groups: resourceGroups(ics), editedAt: Date.now() }],
    expect: [{ href, ics: null }],
  });
  return href;
}

export async function editTask(href, edit) {
  const task = await read(href);
  const result = applyEdit(task.ics, edit, new Date());
  await store.commit({
    putTasks: [{ ...task, ics: result.ics }],
    addOps: [{ kind: "put", href, groups: [...result.groups], editedAt: Date.now() }],
    expect: [{ href, ics: task.ics }],
  });
}

export function view(ics) {
  return readTask(parseResource(ics));
}

export async function quarantined() {
  const out = [];
  for (const [key, value] of await store.allState())
    if (key.startsWith(QUARANTINE) && value !== null) out.push(key.slice(QUARANTINE.length));
  return out.sort();
}
