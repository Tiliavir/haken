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
  readonly putState?: Readonly<Record<string, string | number | null>>;
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

  async state(key: string): Promise<string | number | null> {
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

  /** Applies all changes atomically. Resolves after the data is on disk. */
  async commit(changes: Changes): Promise<void> {
    for (const l of changes.putLists ?? []) toList(l);
    for (const t of changes.putTasks ?? []) toTask(t);
    for (const b of changes.putBase ?? []) toBase(b);
    await transact(this.db, STORES, "readwrite", async (tx) => {
      const tasks = tx.objectStore("tasks");
      for (const e of changes.expect ?? []) {
        const row: unknown = await request(tasks.get(e.href));
        const current = row === undefined ? null : toTask(row).ics;
        if (current !== e.ics)
          throw new StaleError("store", "Task changed during the operation", { href: e.href });
      }
      const outbox = tx.objectStore("outbox");
      for (const id of changes.expectOps ?? []) {
        if ((await request(outbox.get(id))) === undefined) {
          throw new StaleError("store", "Outbox entry vanished during the operation", { id });
        }
      }
      const lists = tx.objectStore("lists");
      for (const l of changes.putLists ?? []) await request(lists.put(l));
      for (const href of changes.deleteLists ?? []) await request(lists.delete(href));
      for (const t of changes.putTasks ?? []) await request(tasks.put(t));
      for (const href of changes.deleteTasks ?? []) await request(tasks.delete(href));
      const base = tx.objectStore("base");
      for (const b of changes.putBase ?? []) await request(base.put(b));
      for (const href of changes.deleteBase ?? []) await request(base.delete(href));
      for (const id of changes.deleteOps ?? []) await request(outbox.delete(id));
      for (const op of changes.addOps ?? []) {
        await request(
          outbox.add({
            schema: SCHEMA,
            kind: op.kind,
            href: op.href,
            groups: [...op.groups],
            editedAt: op.editedAt,
          }),
        );
      }
      const conflicts = tx.objectStore("conflicts");
      for (const id of changes.deleteConflicts ?? []) await request(conflicts.delete(id));
      for (const c of changes.addConflicts ?? [])
        await request(conflicts.add({ schema: SCHEMA, ...c }));
      const state = tx.objectStore("state");
      for (const [key, value] of Object.entries(changes.putState ?? {}))
        await request(state.put({ key, value }));
    });
  }
}
