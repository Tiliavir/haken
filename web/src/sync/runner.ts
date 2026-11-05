/**
 * One sync run: probe, list changes, pull, push
 * ([sync strategy](../../../docs/arc42/adr/ADR-20261103-sync-strategy.md)).
 *
 * Invariants:
 * - The outbox is only shortened after the server confirmed the operation.
 * - Every write is conditional (`If-Match` / `If-None-Match: *`).
 * - A pulled change never overwrites a pending local edit: it is merged, and
 *   the losing value becomes a conflict note.
 * - An unexpected error on one resource (task or list) quarantines it
 *   ([sync quarantine](../../../docs/arc42/adr/ADR-20261104-sync-quarantine.md)):
 *   one error task, a record in the `state` store, its outbox entries kept,
 *   skipped until its server ETag or its local record changes. The run goes on.
 * - Run-level errors (inconsistent outbox, local store) stop the run; the
 *   outbox is untouched and the next trigger retries.
 */
import { HakenError, InvalidInputError } from "../domain/errors.js";
import { merge } from "../domain/merge.js";
import { parseResource, readTask } from "../domain/vtodo.js";
import * as api from "../net/api.js";
import * as caldav from "../net/caldav.js";
import { ExpiredError, UnreachableError } from "../net/http.js";
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

export interface Quarantined {
  /** Task resource or list collection path. */
  readonly href: string;
  readonly error: unknown;
}

export interface SyncHooks {
  /** A server resource failed validation; it was stored read-only. Creates an error task. */
  readonly onInvalid: (info: InvalidResource) => Promise<void>;
  /** An unexpected error on one resource; it is skipped until it changes. Creates an error task. */
  readonly onQuarantine: (info: Quarantined) => Promise<void>;
  readonly onNotice: (notice: Notice) => void;
  /** Local data changed; the UI should reload. */
  readonly onChange: () => void;
}

const MULTIGET_CHUNK = 50;
const STALE_RETRIES = 3;

/**
 * `state` key prefix of a quarantined resource: `quarantine:<href>` for a task
 * and for list changes, `quarantine:pull:<href>` for reading a list.
 */
export const QUARANTINE = "quarantine:";
const PULL = "pull:";
/** Server state of a resource the server reported removed (an ETag is always quoted). */
const GONE = "gone";

/** An error that concerns the whole run, never a single resource: never quarantined. */
class RunError extends HakenError {
  override readonly name: string = "RunError";
}

/**
 * What the failed attempt saw. `server`: the task's ETag (`GONE` when the
 * server reported it removed), the list's sync token, or the raw properties
 * of a list that failed discovery; `null` when not known. `local`: hash of
 * the local record.
 */
interface QuarantineRecord {
  readonly server: string | null;
  readonly local: string;
}

function readQuarantine(key: string, value: string | number | null): QuarantineRecord | null {
  if (value === null) return null;
  const invalid = new InvalidInputError(
    "store",
    "Stored quarantine record has an unexpected shape",
    {
      store: "state",
      key,
    },
  );
  if (typeof value !== "string") throw invalid;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalid;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw invalid;
  const o = parsed as Record<string, unknown>;
  const server = o["server"];
  const local = o["local"];
  if (
    Object.keys(o).sort().join(",") !== "local,server" ||
    (server !== null && typeof server !== "string") ||
    typeof local !== "string"
  )
    throw invalid;
  return { server, local };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Errors that concern one resource. Expected states and run-level errors are not. */
function quarantinable(error: unknown): boolean {
  if (error instanceof UnreachableError || error instanceof ExpiredError) return false;
  if (error instanceof RunError) return false;
  // A failing local store (quota, aborted transaction, corrupt record, lost race) is not about
  // one resource.
  if (error instanceof HakenError && error.layer === "store") return false;
  return true;
}

export function homeOf(user: string): string {
  return `/dav/${encodeURIComponent(user)}/`;
}

export class SyncRunner {
  /** Quarantine records by key (without the prefix), loaded at the start of a run. */
  private quarantine = new Map<string, QuarantineRecord>();
  /** Keys quarantined in this run or skipped as still quarantined. */
  private readonly skipped = new Set<string>();

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
      await this.loadQuarantine();
      await this.pushListOps();
      const tokens = await this.discoverLists();
      for (const list of await this.store.lists()) {
        if (list.state === "synced" && !list.deleted && tokens.has(list.href))
          await this.isolated(
            list.href,
            tokens.get(list.href) ?? null,
            () => this.pull(list),
            PULL,
          );
      }
      await this.pushTaskOps();
      await this.pushListDeletes();
      await this.dropStaleQuarantine();
      await this.store.commit({ putState: { lastSync: Date.now() } });
    } catch (error) {
      // Losing the connection or the session mid-run is expected; the next trigger continues.
      if (error instanceof UnreachableError) return "offline";
      if (error instanceof ExpiredError) return "expired";
      throw error;
    } finally {
      this.hooks.onChange();
    }
    return "synced";
  }

  // ------------------------------------------------------------ quarantine

  private async loadQuarantine(): Promise<void> {
    this.quarantine = new Map();
    this.skipped.clear();
    for (const [key, value] of await this.store.allState()) {
      if (!key.startsWith(QUARANTINE)) continue;
      const record = readQuarantine(key, value);
      if (record !== null) this.quarantine.set(key.slice(QUARANTINE.length), record);
    }
  }

  /**
   * Hash of the local list (href ends with `/`) or task record; a missing
   * record hashes too. A list's sync token is bookkeeping, not a change.
   */
  private async localHash(href: string): Promise<string> {
    if (!href.endsWith("/")) return sha256(JSON.stringify(await this.store.task(href)));
    const list = (await this.store.lists()).find((l) => l.href === href);
    return sha256(JSON.stringify(list === undefined ? null : { ...list, syncToken: null }));
  }

  /**
   * Runs `fn` for one resource (`scope` `PULL`: reading a list). A
   * quarantined resource is skipped unless its server state (`server`, when
   * the caller knows it) or its local record changed. An unexpected error
   * quarantines it and the run goes on; expected states and run-level errors
   * propagate.
   */
  private async isolated(
    href: string,
    server: string | null,
    fn: () => Promise<void>,
    scope = "",
  ): Promise<void> {
    const key = `${scope}${href}`;
    if (this.skipped.has(key)) return;
    const held = this.quarantine.get(key);
    if (
      held !== undefined &&
      held.local === (await this.localHash(href)) &&
      (server === null || server === held.server)
    ) {
      this.skipped.add(key);
      return;
    }
    try {
      await fn();
    } catch (error) {
      if (!quarantinable(error)) throw error;
      this.skipped.add(key);
      const record = { server: server ?? held?.server ?? null, local: await this.localHash(href) };
      await this.store.commit({ putState: { [`${QUARANTINE}${key}`]: JSON.stringify(record) } });
      this.quarantine.set(key, record);
      await this.hooks.onQuarantine({ href, error });
      return;
    }
    if (held !== undefined) {
      await this.store.commit({ putState: { [`${QUARANTINE}${key}`]: null } });
      this.quarantine.delete(key);
    }
  }

  /**
   * Drops records whose list no longer exists locally (deleted, or a list that
   * failed discovery and is gone from the server), so the status count stays true.
   */
  private async dropStaleQuarantine(): Promise<void> {
    const lists = new Set((await this.store.lists()).map((l) => l.href));
    const parent = (href: string): string =>
      href.slice(0, href.lastIndexOf("/", href.length - 2) + 1);
    const drop: Record<string, null> = {};
    for (const key of this.quarantine.keys()) {
      const href = key.startsWith(PULL) ? key.slice(PULL.length) : key;
      if (!this.skipped.has(key) && !lists.has(href) && !lists.has(parent(href)))
        drop[`${QUARANTINE}${key}`] = null;
    }
    if (Object.keys(drop).length === 0) return;
    await this.store.commit({ putState: drop });
    for (const key of Object.keys(drop)) this.quarantine.delete(key.slice(QUARANTINE.length));
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
        throw new RunError("sync", "Outbox entry for unknown list", {
          path: op.href,
          kind: op.kind,
        });
      await this.isolated(list.href, null, async () => {
        if (op.kind === "mkcalendar") {
          await caldav.makeCalendar(list.href, list.displayName, list.order);
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
      });
    }
  }

  /** Returns the current sync token (RFC 6578 4) of every valid list on the server. */
  private async discoverLists(): Promise<Map<string, string | null>> {
    const found = await caldav.listCollections(homeOf(this.user));
    const remote = found.lists;
    // A list with invalid properties is quarantined on its own; it is neither added nor removed.
    const invalid = new Set(found.invalid.map((i) => i.href));
    for (const bad of found.invalid)
      await this.isolated(bad.href, bad.signature, () => Promise.reject(bad.error), PULL);
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
      if (list.state === "new" || invalid.has(list.href)) continue;
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
    return new Map(remote.map((r) => [r.href, r.syncToken]));
  }

  private async pushListDeletes(): Promise<void> {
    for (const op of (await this.store.outbox()).filter((o) => o.kind === "deletelist")) {
      const remaining = (await this.store.tasks()).filter((t) => t.list === op.href);
      if (remaining.length > 0) continue; // task deletes still pending or failed; retry next run
      await this.isolated(op.href, null, async () => {
        const members = await caldav.memberCount(op.href);
        if (members > 0) {
          // Another client added tasks since: keep the list (nothing is deleted that haken has not seen).
          const list = (await this.store.lists()).find((l) => l.href === op.href);
          if (list !== undefined)
            await this.store.commit({
              putLists: [{ ...list, deleted: false }],
              deleteOps: [op.id],
            });
          this.hooks.onNotice({ kind: "restored", href: op.href });
          return;
        }
        await caldav.deleteCollection(op.href);
        await this.store.commit({ deleteLists: [op.href], deleteOps: [op.id] });
      });
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
      // Quarantined resources never stored locally count too, so their records are released.
      const held = [...this.quarantine.keys()].filter(
        (k) => k.startsWith(list.href) && k !== list.href,
      );
      changed = all;
      removed = [...new Set([...local.map((t) => t.href), ...held])].filter((h) => !remote.has(h));
      token = null;
    }
    const known = new Map((await this.store.tasks()).map((t) => [t.href, t.etag]));
    const toFetch = changed.filter((c) => known.get(c.href) !== c.etag).map((c) => c.href);
    for (let i = 0; i < toFetch.length; i += MULTIGET_CHUNK) {
      const chunk = toFetch.slice(i, i + MULTIGET_CHUNK);
      const resources = await caldav.multiget(list.href, chunk);
      const got = new Set(resources.map((r) => r.href));
      for (const r of resources)
        await this.isolated(r.href, r.etag, () =>
          this.retryStale(() => this.applyRemote(list.href, r)),
        );
      for (const href of chunk)
        if (!got.has(href))
          await this.isolated(href, GONE, () => this.retryStale(() => this.applyRemoval(href)));
    }
    for (const href of removed)
      await this.isolated(href, GONE, () => this.retryStale(() => this.applyRemoval(href)));
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
      await this.isolated(href, null, async () => {
        for (let attempt = 1; ; attempt++) {
          const done = await this.pushOne(href);
          if (done) return;
          if (attempt >= STALE_RETRIES) {
            throw new HakenError("sync", "Push did not settle after merging", {
              path: href,
              attempts: attempt,
            });
          }
        }
      });
    }
  }

  /** Returns `true` when the resource is settled for this run. */
  private async pushOne(href: string): Promise<boolean> {
    const record = await this.store.task(href);
    const ops = await this.opsFor(href);
    if (ops.length === 0) return true;
    if (record === null) throw new RunError("sync", "Outbox entry without task", { path: href });
    if (record.invalid !== null)
      throw new RunError("sync", "Outbox entry for unreadable task", { path: href });
    const list = (await this.store.lists()).find((l) => l.href === record.list);
    if (list === undefined || list.state !== "synced") return true; // waits for MKCALENDAR
    const ids = ops.map((o) => o.id);

    if (record.deleted) {
      // A task moved to another list: the old copy goes only after the new one is on the server.
      const moved = (await this.store.tasks()).some(
        (t) => t.uid === record.uid && t.href !== href && !t.deleted && t.etag === null,
      );
      if (moved) return true;
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
    // The server refused this exact content as too large: retry only after the task changed.
    const refused = await this.store.state(`tooLarge:${href}`);
    if (typeof refused === "string" && refused === (await sha256(sent))) return true;
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
        // The server has the new version now. An edit made during the PUT makes the commit
        // stale; it is retried on the fresh record, which keeps that edit and its outbox
        // entries for the next push.
        const confirmed = etag;
        await this.retryStale(async () => {
          const current = await this.store.task(href);
          if (current === null)
            throw new RunError("sync", "Task vanished during push", { path: href });
          await this.store.commit({
            putTasks: [
              {
                ...current,
                etag: confirmed,
                ics: current.ics === sent ? serverIcs : current.ics,
              },
            ],
            putBase: [{ schema: SCHEMA, href, ics: serverIcs, etag: confirmed }],
            deleteOps: ids,
            putState: { [`tooLarge:${href}`]: null },
            expect: [{ href, ics: current.ics }],
            expectOps: ids,
          });
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
        await this.store.commit({ putState: { [`tooLarge:${href}`]: await sha256(sent) } });
        this.hooks.onNotice({ kind: "too-large", href });
        return true;
      case "not-found":
        throw new HakenError("sync", "Collection missing on PUT", { path: href });
      case "uid-conflict":
        throw new HakenError("sync", "UID used by another resource in the list", {
          path: href,
          uid: record.uid,
        });
    }
  }
}
