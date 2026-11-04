/**
 * One sync run: probe, list changes, pull, push
 * ([sync strategy](../../../docs/arc42/adr/ADR-20261103-sync-strategy.md)).
 *
 * Invariants:
 * - The outbox is only shortened after the server confirmed the operation.
 * - Every write is conditional (`If-Match` / `If-None-Match: *`).
 * - A pulled change never overwrites a pending local edit: it is merged, and
 *   the losing value becomes a conflict note.
 * - An unexpected error stops the run; the outbox is untouched and the next
 *   trigger retries.
 */
import { HakenError, InvalidInputError } from "../domain/errors.js";
import { merge } from "../domain/merge.js";
import { parseResource, readTask } from "../domain/vtodo.js";
import * as api from "../net/api.js";
import * as caldav from "../net/caldav.js";
import { UnreachableError } from "../net/http.js";
import { type AccountStore, type Changes, StaleError } from "../store/account.js";
import {
  type ListRecord,
  type OutboxInput,
  type OutboxRecord,
  SCHEMA,
  type TaskRecord,
} from "../store/records.js";

export type RunResult = "synced" | "offline" | "expired" | "busy";

export type Notice =
  | { readonly kind: "merged"; readonly href: string }
  | { readonly kind: "restored"; readonly href: string }
  | { readonly kind: "too-large"; readonly href: string };

export interface InvalidResource {
  readonly href: string;
  readonly list: string;
  readonly error: InvalidInputError;
}

export interface SyncHooks {
  /** A server resource failed validation; it was stored read-only. Creates an error task. */
  readonly onInvalid: (info: InvalidResource) => Promise<void>;
  readonly onNotice: (notice: Notice) => void;
  /** Local data changed; the UI should reload. */
  readonly onChange: () => void;
}

const MULTIGET_CHUNK = 50;
const STALE_RETRIES = 3;

export function homeOf(user: string): string {
  return `/dav/${encodeURIComponent(user)}/`;
}

export class SyncRunner {
  constructor(
    private readonly store: AccountStore,
    private readonly user: string,
    private readonly hooks: SyncHooks,
  ) {}

  /** Runs once under a Web Lock; a second tab gets `busy`. */
  async run(): Promise<RunResult> {
    const result = await navigator.locks.request(
      `haken-sync-${this.store.accountId}`,
      { ifAvailable: true },
      async (lock): Promise<RunResult> => {
        if (lock === null) return "busy";
        return this.runLocked();
      },
    );
    return result;
  }

  private async runLocked(): Promise<RunResult> {
    const probe = await api.probe(this.user);
    if (probe.kind === "unreachable") return "offline";
    if (probe.kind === "expired") return "expired";
    try {
      await this.pushListOps();
      await this.discoverLists();
      for (const list of await this.store.lists()) {
        if (list.state === "synced" && !list.deleted) await this.pull(list);
      }
      await this.pushTaskOps();
      await this.pushListDeletes();
      await this.store.commit({ putState: { lastSync: Date.now() } });
    } catch (error) {
      // Losing the connection mid-run is expected; the next trigger continues.
      if (error instanceof UnreachableError) return "offline";
      throw error;
    } finally {
      this.hooks.onChange();
    }
    return "synced";
  }

  // ------------------------------------------------------------ lists

  private async pushListOps(): Promise<void> {
    const ops = (await this.store.outbox()).filter(
      (o) => o.kind === "mkcalendar" || o.kind === "proppatch",
    );
    const lists = new Map((await this.store.lists()).map((l) => [l.href, l]));
    for (const op of ops) {
      const list = lists.get(op.href);
      if (list === undefined)
        throw new HakenError("sync", "Outbox entry for unknown list", {
          path: op.href,
          kind: op.kind,
        });
      if (op.kind === "mkcalendar") {
        await caldav.makeCalendar(list.href, list.displayName);
        const synced: ListRecord = { ...list, state: "synced" };
        await this.store.commit({ putLists: [synced], deleteOps: [op.id] });
        lists.set(list.href, synced);
      } else {
        await caldav.patchList(list.href, {
          ...(op.groups.includes("displayName") ? { displayName: list.displayName } : {}),
          ...(op.groups.includes("color") ? { color: list.color } : {}),
          ...(op.groups.includes("order") ? { order: list.order } : {}),
        });
        await this.store.commit({ deleteOps: [op.id] });
      }
    }
  }

  private async discoverLists(): Promise<void> {
    const remote = await caldav.listCollections(homeOf(this.user));
    const remoteByHref = new Map(remote.map((r) => [r.href, r]));
    const local = await this.store.lists();
    const ops = await this.store.outbox();
    const tasks = await this.store.tasks();
    const changes = {
      putLists: [] as ListRecord[],
      deleteLists: [] as string[],
      deleteTasks: [] as string[],
      deleteBase: [] as string[],
      addOps: [] as OutboxInput[],
      putTasks: [] as TaskRecord[],
    } satisfies Changes;
    const localHrefs = new Set(local.map((l) => l.href));

    for (const r of remote) {
      if (!localHrefs.has(r.href)) {
        changes.putLists.push({
          schema: SCHEMA,
          href: r.href,
          displayName: r.displayName,
          color: r.color,
          order: r.order,
          syncToken: null,
          state: "synced",
          deleted: false,
        });
      }
    }
    for (const list of local) {
      if (list.state === "new") continue;
      const r = remoteByHref.get(list.href);
      if (r !== undefined) {
        const pendingPatch = ops.some((o) => o.kind === "proppatch" && o.href === list.href);
        if (
          !pendingPatch &&
          (r.displayName !== list.displayName || r.color !== list.color || r.order !== list.order)
        ) {
          changes.putLists.push({
            ...list,
            displayName: r.displayName,
            color: r.color,
            order: r.order,
          });
        }
        continue;
      }
      // Deleted on the server (by another client, or our confirmed deletelist).
      const listTasks = tasks.filter((t) => t.list === list.href);
      const pending = listTasks.filter((t) =>
        ops.some((o) => o.href === t.href && o.kind === "put"),
      );
      if (pending.length === 0 || list.deleted) {
        changes.deleteLists.push(list.href);
        for (const t of listTasks) {
          changes.deleteTasks.push(t.href);
          changes.deleteBase.push(t.href);
        }
        continue;
      }
      // Local edits exist: re-create the list and those tasks instead of losing them.
      changes.putLists.push({ ...list, state: "new", syncToken: null });
      changes.addOps.push({
        kind: "mkcalendar",
        href: list.href,
        groups: [],
        editedAt: Date.now(),
      });
      for (const t of listTasks) {
        if (pending.includes(t)) {
          changes.putTasks.push({ ...t, etag: null });
          changes.deleteBase.push(t.href);
        } else {
          changes.deleteTasks.push(t.href);
          changes.deleteBase.push(t.href);
        }
      }
    }
    const ids = ops.filter((o) => changes.deleteTasks.includes(o.href)).map((o) => o.id);
    await this.store.commit({ ...changes, deleteOps: ids });
  }

  private async pushListDeletes(): Promise<void> {
    for (const op of (await this.store.outbox()).filter((o) => o.kind === "deletelist")) {
      const remaining = (await this.store.tasks()).filter((t) => t.list === op.href);
      if (remaining.length > 0) continue; // task deletes still pending or failed; retry next run
      const members = await caldav.memberCount(op.href);
      if (members > 0) {
        // Another client added tasks since: keep the list (nothing is deleted that haken has not seen).
        const list = (await this.store.lists()).find((l) => l.href === op.href);
        if (list !== undefined)
          await this.store.commit({ putLists: [{ ...list, deleted: false }], deleteOps: [op.id] });
        this.hooks.onNotice({ kind: "restored", href: op.href });
        continue;
      }
      await caldav.deleteCollection(op.href);
      await this.store.commit({ deleteLists: [op.href], deleteOps: [op.id] });
    }
  }

  // ------------------------------------------------------------ pull

  private async pull(list: ListRecord): Promise<void> {
    let changed: { href: string; etag: string }[];
    let removed: string[];
    let token: string | null;
    const result = await caldav.syncCollection(list.href, list.syncToken);
    if (result.kind === "ok") {
      changed = [...result.changed];
      removed = [...result.removed];
      token = result.token;
    } else {
      // Token no longer valid: compare all ETags, then start over with a fresh token.
      const all = await caldav.listEtags(list.href);
      const local = (await this.store.tasks()).filter(
        (t) => t.list === list.href && t.etag !== null,
      );
      const remote = new Set(all.map((a) => a.href));
      changed = all;
      removed = local.filter((t) => !remote.has(t.href)).map((t) => t.href);
      token = null;
    }
    const known = new Map((await this.store.tasks()).map((t) => [t.href, t.etag]));
    const toFetch = changed.filter((c) => known.get(c.href) !== c.etag).map((c) => c.href);
    for (let i = 0; i < toFetch.length; i += MULTIGET_CHUNK) {
      const chunk = toFetch.slice(i, i + MULTIGET_CHUNK);
      const resources = await caldav.multiget(list.href, chunk);
      const got = new Set(resources.map((r) => r.href));
      for (const r of resources) await this.retryStale(() => this.applyRemote(list.href, r));
      for (const href of chunk)
        if (!got.has(href)) await this.retryStale(() => this.applyRemoval(href));
    }
    for (const href of removed) await this.retryStale(() => this.applyRemoval(href));
    if (token === null) {
      const fresh = await caldav.syncCollection(list.href, null);
      if (fresh.kind !== "ok")
        throw new HakenError("sync", "Server rejected the initial sync token", { path: list.href });
      token = fresh.token;
    }
    const current = (await this.store.lists()).find((l) => l.href === list.href);
    if (current !== undefined)
      await this.store.commit({ putLists: [{ ...current, syncToken: token }] });
  }

  private async retryStale(fn: () => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await fn();
        return;
      } catch (error) {
        if (!(error instanceof StaleError) || attempt >= STALE_RETRIES) throw error;
      }
    }
  }

  private async opsFor(href: string): Promise<OutboxRecord[]> {
    return (await this.store.outbox()).filter(
      (o) => o.href === href && (o.kind === "put" || o.kind === "delete"),
    );
  }

  /** Applies a server version of one resource. */
  async applyRemote(list: string, remote: caldav.RemoteResource): Promise<void> {
    const local = await this.store.task(remote.href);
    const base = await this.store.base(remote.href);
    const ops = await this.opsFor(remote.href);
    const expect = [{ href: remote.href, ics: local?.ics ?? null }];
    const expectOps = ops.map((o) => o.id);

    let uid: string;
    try {
      uid = readTask(parseResource(remote.ics)).uid;
    } catch (error) {
      if (!(error instanceof InvalidInputError)) throw error;
      const record: TaskRecord = {
        schema: SCHEMA,
        href: remote.href,
        list,
        uid: local?.uid ?? remote.href,
        ics: remote.ics,
        etag: remote.etag,
        deleted: false,
        invalid: error.message,
      };
      const keep =
        local !== null && ops.length > 0 && local.invalid === null
          ? [
              {
                href: remote.href,
                uid: local.uid,
                group: "*",
                lines: local.ics,
                lost: "local" as const,
                at: Date.now(),
              },
            ]
          : [];
      await this.store.commit({
        putTasks: [record],
        deleteBase: [remote.href],
        deleteOps: ops.map((o) => o.id),
        addConflicts: keep,
        expect,
        expectOps,
      });
      await this.hooks.onInvalid({ href: remote.href, list, error });
      return;
    }

    const confirmed = (ics: string): TaskRecord => ({
      schema: SCHEMA,
      href: remote.href,
      list,
      uid,
      ics,
      etag: remote.etag,
      deleted: false,
      invalid: null,
    });
    const newBase = { schema: SCHEMA, href: remote.href, ics: remote.ics, etag: remote.etag };

    if (local === null || ops.length === 0) {
      await this.store.commit({
        putTasks: [confirmed(remote.ics)],
        putBase: [newBase],
        expect,
        expectOps,
      });
      return;
    }
    if (base !== null && base.etag === remote.etag && local.etag === remote.etag) return;

    if (ops.some((o) => o.kind === "delete")) {
      // Delete against a changed server version: the change wins, the task comes back.
      await this.store.commit({
        putTasks: [confirmed(remote.ics)],
        putBase: [newBase],
        deleteOps: ops.map((o) => o.id),
        expect,
        expectOps,
      });
      this.hooks.onNotice({ kind: "restored", href: remote.href });
      return;
    }

    const times = new Map<string, number>();
    for (const op of ops)
      for (const g of op.groups) times.set(g, Math.max(times.get(g) ?? 0, op.editedAt));
    const result = merge(base?.ics ?? null, local.ics, remote.ics, times);
    const now = Date.now();
    await this.store.commit({
      putTasks: [confirmed(result.ics)],
      putBase: [newBase],
      // Nothing local survived the merge: there is nothing left to push.
      deleteOps: result.localWins.length === 0 ? ops.map((o) => o.id) : [],
      addConflicts: result.notes.map((n) => ({
        href: remote.href,
        uid,
        group: n.group,
        lines: n.lines,
        lost: n.lost,
        at: now,
      })),
      expect,
      expectOps,
    });
    if (result.notes.length > 0) this.hooks.onNotice({ kind: "merged", href: remote.href });
  }

  /** The server no longer has the resource. */
  async applyRemoval(href: string): Promise<void> {
    const local = await this.store.task(href);
    if (local === null) return;
    const ops = await this.opsFor(href);
    const expect = [{ href, ics: local.ics }];
    const expectOps = ops.map((o) => o.id);
    const conflicts = (await this.store.conflicts())
      .filter((c) => c.href === href)
      .map((c) => c.id);
    if (ops.length === 0 || local.deleted || local.invalid !== null) {
      await this.store.commit({
        deleteTasks: [href],
        deleteBase: [href],
        deleteOps: expectOps,
        deleteConflicts: conflicts,
        expect,
        expectOps,
      });
      return;
    }
    // A local edit against a deleted resource: re-create it (If-None-Match: *).
    await this.store.commit({
      putTasks: [{ ...local, etag: null }],
      deleteBase: [href],
      expect,
      expectOps,
    });
  }

  // ------------------------------------------------------------ push

  private async pushTaskOps(): Promise<void> {
    const ops = (await this.store.outbox()).filter((o) => o.kind === "put" || o.kind === "delete");
    const hrefs = [...new Set(ops.map((o) => o.href))];
    for (const href of hrefs) {
      for (let attempt = 1; ; attempt++) {
        const done = await this.pushOne(href);
        if (done) break;
        if (attempt >= STALE_RETRIES) {
          throw new HakenError("sync", "Push did not settle after merging", {
            path: href,
            attempts: attempt,
          });
        }
      }
    }
  }

  /** Returns `true` when the resource is settled for this run. */
  private async pushOne(href: string): Promise<boolean> {
    const record = await this.store.task(href);
    const ops = await this.opsFor(href);
    if (ops.length === 0) return true;
    if (record === null) throw new HakenError("sync", "Outbox entry without task", { path: href });
    if (record.invalid !== null)
      throw new HakenError("sync", "Outbox entry for unreadable task", { path: href });
    const list = (await this.store.lists()).find((l) => l.href === record.list);
    if (list === undefined || list.state !== "synced") return true; // waits for MKCALENDAR
    const ids = ops.map((o) => o.id);

    if (record.deleted) {
      if (record.etag === null) {
        await this.store.commit({
          deleteTasks: [href],
          deleteBase: [href],
          deleteOps: ids,
          expectOps: ids,
        });
        return true;
      }
      const result = await caldav.del(href, record.etag);
      if (result === "deleted" || result === "gone") {
        const conflicts = (await this.store.conflicts())
          .filter((c) => c.href === href)
          .map((c) => c.id);
        await this.store.commit({
          deleteTasks: [href],
          deleteBase: [href],
          deleteOps: ids,
          deleteConflicts: conflicts,
        });
        return true;
      }
      const remote = await caldav.get(href);
      if (remote === null) await this.retryStale(() => this.applyRemoval(href));
      else await this.retryStale(() => this.applyRemote(record.list, remote));
      return false;
    }

    const sent = record.ics;
    const result = await caldav.put(href, sent, record.etag);
    switch (result.kind) {
      case "ok": {
        let etag = result.etag;
        let serverIcs = sent;
        if (etag === null) {
          // The server changed the content on write and returned no ETag (RFC 4791 5.3.4).
          const remote = await caldav.get(href);
          if (remote === null)
            throw new HakenError("sync", "Resource missing right after PUT", { path: href });
          etag = remote.etag;
          serverIcs = remote.ics;
        }
        const current = await this.store.task(href);
        if (current === null)
          throw new HakenError("sync", "Task vanished during push", { path: href });
        const unchanged = current.ics === sent;
        await this.store.commit({
          putTasks: [{ ...current, etag, ics: unchanged ? serverIcs : current.ics }],
          putBase: [{ schema: SCHEMA, href, ics: serverIcs, etag }],
          deleteOps: ids,
          putState: { [`tooLarge:${href}`]: null },
          expect: [{ href, ics: current.ics }],
          expectOps: ids,
        });
        return true;
      }
      case "precondition": {
        const remote = await caldav.get(href);
        if (remote === null) await this.retryStale(() => this.applyRemoval(href));
        else await this.retryStale(() => this.applyRemote(record.list, remote));
        return false;
      }
      case "too-large":
        await this.store.commit({ putState: { [`tooLarge:${href}`]: Date.now() } });
        this.hooks.onNotice({ kind: "too-large", href });
        return true;
      case "not-found":
        throw new HakenError("sync", "Collection missing on PUT", { path: href });
    }
  }
}
