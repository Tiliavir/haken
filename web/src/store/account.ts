/**
 * Per-account database: lists, tasks, merge base, outbox, conflict notes.
 * One database per account (`haken-account-<id>`); another account on the
 * same device never sees it.
 *
 * Every change goes through `commit`, which applies all parts in one
 * transaction. `expect` guards against lost updates: sync computes changes
 * from what it read, and if a task changed meanwhile (the user kept
 * editing), the commit fails with `StaleError` and sync recomputes.
 */
import { HakenError } from "../domain/errors.js";
import { open, remove, request, transact } from "./idb.js";
import {
  type BaseRecord,
  type ConflictInput,
  type ConflictRecord,
  type ListRecord,
  type OutboxInput,
  type OutboxRecord,
  SCHEMA,
  type TaskRecord,
  toBase,
  toConflict,
  toList,
  toOutbox,
  toTask,
} from "./records.js";

const STORES = ["lists", "tasks", "base", "outbox", "conflicts", "state"] as const;

export class StaleError extends HakenError {
  override readonly name: string = "StaleError";
}

/** Value of a `state` entry. */
export type StateValue = string | number | null;

export interface Changes {
  readonly putLists?: readonly ListRecord[];
  readonly deleteLists?: readonly string[];
  readonly putTasks?: readonly TaskRecord[];
  readonly deleteTasks?: readonly string[];
  readonly putBase?: readonly BaseRecord[];
  readonly deleteBase?: readonly string[];
  readonly addOps?: readonly OutboxInput[];
  readonly deleteOps?: readonly number[];
  readonly addConflicts?: readonly ConflictInput[];
  readonly deleteConflicts?: readonly number[];
  readonly putState?: Readonly<Record<string, StateValue>>;
  /** Each task's `ics` must still be this (`null`: must not exist), else `StaleError`. */
  readonly expect?: readonly { readonly href: string; readonly ics: string | null }[];
  /** These outbox ids must still exist, else `StaleError`. */
  readonly expectOps?: readonly number[];
}

export function databaseName(accountId: string): string {
  return `haken-account-${accountId}`;
}

export class AccountStore {
  private constructor(
    private readonly db: IDBDatabase,
    readonly accountId: string,
  ) {}

  static async open(accountId: string): Promise<AccountStore> {
    const db = await open(databaseName(accountId), 1, (d, old) => {
      if (old < 1) {
        d.createObjectStore("lists", { keyPath: "href" });
        const tasks = d.createObjectStore("tasks", { keyPath: "href" });
        tasks.createIndex("list", "list");
        tasks.createIndex("uid", "uid");
        d.createObjectStore("base", { keyPath: "href" });
        d.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
        const conflicts = d.createObjectStore("conflicts", { keyPath: "id", autoIncrement: true });
        conflicts.createIndex("href", "href");
        d.createObjectStore("state", { keyPath: "key" });
      }
    });
    return new AccountStore(db, accountId);
  }

  static async destroy(accountId: string): Promise<void> {
    await remove(databaseName(accountId));
  }

  close(): void {
    this.db.close();
  }

  private all<T>(store: string, convert: (v: unknown) => T): Promise<T[]> {
    return transact(this.db, [store], "readonly", async (tx) =>
      ((await request(tx.objectStore(store).getAll())) as unknown[]).map(convert),
    );
  }

  lists(): Promise<ListRecord[]> {
    return this.all("lists", toList);
  }

  tasks(): Promise<TaskRecord[]> {
    return this.all("tasks", toTask);
  }

  outbox(): Promise<OutboxRecord[]> {
    return this.all("outbox", toOutbox);
  }

  conflicts(): Promise<ConflictRecord[]> {
    return this.all("conflicts", toConflict);
  }

  bases(): Promise<BaseRecord[]> {
    return this.all("base", toBase);
  }

  async task(href: string): Promise<TaskRecord | null> {
    const row: unknown = await transact(this.db, ["tasks"], "readonly", (tx) =>
      request(tx.objectStore("tasks").get(href)),
    );
    return row === undefined ? null : toTask(row);
  }

  async base(href: string): Promise<BaseRecord | null> {
    const row: unknown = await transact(this.db, ["base"], "readonly", (tx) =>
      request(tx.objectStore("base").get(href)),
    );
    return row === undefined ? null : toBase(row);
  }

  async state(key: string): Promise<StateValue> {
    const row = (await transact(this.db, ["state"], "readonly", (tx) =>
      request(tx.objectStore("state").get(key)),
    )) as { value?: unknown } | undefined;
    if (row === undefined) return null;
    const v = row.value;
    if (v !== null && typeof v !== "string" && typeof v !== "number") {
      throw new HakenError("store", "Stored state has an unexpected value", {
        store: "state",
        key,
      });
    }
    return v;
  }

  async allState(): Promise<Map<string, StateValue>> {
    const rows = (await transact(this.db, ["state"], "readonly", (tx) =>
      request(tx.objectStore("state").getAll()),
    )) as unknown[];
    const out = new Map<string, StateValue>();
    for (const row of rows) {
      const { key, value } = (row ?? {}) as { key?: unknown; value?: unknown };
      if (
        typeof key !== "string" ||
        (value !== null && typeof value !== "string" && typeof value !== "number")
      ) {
        throw new HakenError("store", "Stored state has an unexpected value", { store: "state" });
      }
      out.set(key, value);
    }
    return out;
  }

  /** Applies all changes atomically. Resolves after the data is on disk. */
  async commit(changes: Changes): Promise<void> {
    for (const l of changes.putLists ?? []) toList(l);
    for (const t of changes.putTasks ?? []) toTask(t);
    for (const b of changes.putBase ?? []) toBase(b);
    await transact(this.db, STORES, "readwrite", async (tx) => {
      await checkExpectations(tx, changes);
      await applyChanges(tx, changes);
    });
  }
}

/** Throws `StaleError` if a task or outbox entry the changes rely on changed meanwhile. */
async function checkExpectations(tx: IDBTransaction, changes: Changes): Promise<void> {
  const tasks = tx.objectStore("tasks");
  const outbox = tx.objectStore("outbox");
  const expect = changes.expect ?? [];
  const expectOps = changes.expectOps ?? [];
  const [rows, ops] = await Promise.all([
    Promise.all(expect.map((e) => request(tasks.get(e.href)))),
    Promise.all(expectOps.map((id) => request(outbox.get(id)))),
  ]);
  for (const [i, e] of expect.entries()) {
    const row: unknown = rows[i];
    const current = row === undefined ? null : toTask(row).ics;
    if (current !== e.ics)
      throw new StaleError("store", "Task changed during the operation", { href: e.href });
  }
  for (const [i, id] of expectOps.entries()) {
    if (ops[i] === undefined)
      throw new StaleError("store", "Outbox entry vanished during the operation", { id });
  }
}

/**
 * Issues all requests at once: IndexedDB runs requests of a transaction in
 * the order they were placed, and a failed request aborts the transaction.
 */
async function applyChanges(tx: IDBTransaction, changes: Changes): Promise<void> {
  const tasks = tx.objectStore("tasks");
  const outbox = tx.objectStore("outbox");
  const lists = tx.objectStore("lists");
  const base = tx.objectStore("base");
  const conflicts = tx.objectStore("conflicts");
  const state = tx.objectStore("state");
  const requests: Promise<unknown>[] = [
    ...(changes.putLists ?? []).map((l) => request(lists.put(l))),
    ...(changes.deleteLists ?? []).map((href) => request(lists.delete(href))),
    ...(changes.putTasks ?? []).map((t) => request(tasks.put(t))),
    ...(changes.deleteTasks ?? []).map((href) => request(tasks.delete(href))),
    ...(changes.putBase ?? []).map((b) => request(base.put(b))),
    ...(changes.deleteBase ?? []).map((href) => request(base.delete(href))),
    ...(changes.deleteOps ?? []).map((id) => request(outbox.delete(id))),
    ...(changes.addOps ?? []).map((op) =>
      request(
        outbox.add({
          schema: SCHEMA,
          kind: op.kind,
          href: op.href,
          groups: [...op.groups],
          editedAt: op.editedAt,
        }),
      ),
    ),
    ...(changes.deleteConflicts ?? []).map((id) => request(conflicts.delete(id))),
    ...(changes.addConflicts ?? []).map((c) => request(conflicts.add({ schema: SCHEMA, ...c }))),
    ...Object.entries(changes.putState ?? {}).map(([key, value]) =>
      request(state.put({ key, value })),
    ),
  ];
  await Promise.all(requests);
}
