/**
 * Minimal promise wrapper around IndexedDB. Every transaction uses
 * `durability: "strict"`: it completes only after the data is on disk, so
 * "saved" in the UI means saved.
 */
import { HakenError } from "../domain/errors.js";

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(
        new HakenError("store", "IndexedDB request failed", { error: String(req.error?.name) }),
      );
  });
}

export type Upgrade = (db: IDBDatabase, oldVersion: number, tx: IDBTransaction) => void;

export function open(name: string, version: number, upgrade: Upgrade): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, version);
    req.onupgradeneeded = (event) => {
      const tx = req.transaction;
      if (tx === null) {
        reject(new HakenError("store", "Upgrade without transaction", { database: name }));
        return;
      }
      upgrade(req.result, event.oldVersion, tx);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () =>
      reject(
        new HakenError("store", "Cannot open database", {
          database: name,
          error: String(req.error?.name),
        }),
      );
    req.onblocked = () =>
      reject(new HakenError("store", "Database open blocked", { database: name }));
  });
}

export function remove(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () =>
      reject(
        new HakenError("store", "Cannot delete database", {
          database: name,
          error: String(req.error?.name),
        }),
      );
    req.onblocked = () =>
      reject(new HakenError("store", "Database delete blocked", { database: name }));
  });
}

/**
 * Runs `fn` in one transaction and resolves after the transaction has
 * committed. If `fn` throws, the transaction is aborted: all or nothing.
 */
export async function transact<T>(
  db: IDBDatabase,
  stores: readonly string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction([...stores], mode, { durability: "strict" });
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () =>
      reject(
        new HakenError("store", "Transaction aborted", {
          error: String(tx.error?.name ?? "abort"),
        }),
      );
    tx.onerror = (event) => event.preventDefault();
  });
  let result: T;
  try {
    result = await fn(tx);
  } catch (error) {
    abortQuietly(tx);
    await done.then(
      () => undefined,
      () => undefined,
    );
    throw error;
  }
  await done;
  return result;
}

function abortQuietly(tx: IDBTransaction): void {
  try {
    tx.abort();
  } catch (error) {
    // Expected only when the transaction already finished on its own.
    if (!(error instanceof DOMException && error.name === "InvalidStateError")) throw error;
  }
}

/** Probes whether IndexedDB is usable at all (fails in some private windows). */
export async function usable(): Promise<boolean> {
  if (typeof indexedDB === "undefined") return false;
  try {
    const db = await open("haken-probe", 1, (d) => d.createObjectStore("x"));
    db.close();
    await remove("haken-probe");
    return true;
  } catch (error) {
    if (error instanceof HakenError) return false;
    throw error;
  }
}
