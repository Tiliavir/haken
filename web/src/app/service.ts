/**
 * Application service: the only API the UI uses. Commands write the local
 * store (task + outbox entry in one transaction) and return after the data
 * is on disk; sync runs separately. Queries are snapshots rebuilt from the
 * store after every change.
 */
import { type AppConfig, parseConfig } from "../domain/config.js";
import { HakenError, InvalidInputError } from "../domain/errors.js";
import {
  bumpErrorTask,
  createErrorTask,
  ERRORLOGS,
  type ErrorReport,
  fingerprintOf,
} from "../domain/errortask.js";
import { type ImportResult, joinIcsFile, splitIcsFile } from "../domain/icsfile.js";
import { compareTasks, orderAtEnd, orderOnTop, reorder } from "../domain/order.js";
import {
  appleSeconds,
  applyEdit,
  attachmentData,
  bytesToBase64,
  createTask,
  type Due,
  parseResource,
  readTask,
  resourceGroups,
  type TaskEdit,
  type TaskView,
} from "../domain/vtodo.js";
import * as api from "../net/api.js";
import * as caldav from "../net/caldav.js";
import { setBasePath, staticJson, UnreachableError } from "../net/http.js";
import { AccountStore, type Changes } from "../store/account.js";
import { usable } from "../store/idb.js";
import { MetaStore, type Settings } from "../store/meta.js";
import {
  type AccountRecord,
  type ConflictRecord,
  type ListRecord,
  SCHEMA,
  type SetupStep,
  type TaskRecord,
} from "../store/records.js";
import { homeOf, type Notice, SyncRunner } from "../sync/runner.js";
import { APP_VERSION, ErrorReporter, type ErrorSink } from "./errors.js";

export type { Theme } from "../store/meta.js";
export type { SetupStep } from "../store/records.js";
export type { Notice } from "../sync/runner.js";

export const DEFAULT_LIST = "Haken";
export const ATTACHMENT_LIMIT = 5 * 1024 * 1024;
const ERROR_TASKS_PER_DAY = 20;

export interface TaskItem {
  readonly href: string;
  readonly list: string;
  /** `null` when the resource could not be read (shown read-only, *Cannot be read*). */
  readonly view: TaskView | null;
  readonly invalid: string | null;
  readonly steps: readonly TaskItem[];
  readonly conflicts: readonly ConflictRecord[];
  readonly pending: boolean;
  readonly tooLarge: boolean;
}

export interface ListItem {
  readonly href: string;
  readonly name: string;
  readonly color: string | null;
  readonly errorlogs: boolean;
  /** Top-level tasks, open ones in manual order, then completed ones by completion time. */
  readonly tasks: readonly TaskItem[];
  readonly openCount: number;
}

export type SyncStatus =
  | { readonly kind: "local" }
  | { readonly kind: "synced" }
  | { readonly kind: "pending"; readonly count: number }
  | { readonly kind: "syncing"; readonly count: number }
  | { readonly kind: "offline"; readonly count: number }
  | { readonly kind: "signin"; readonly count: number }
  | { readonly kind: "error"; readonly count: number };

export interface Snapshot {
  readonly account: AccountRecord | null;
  readonly settings: Settings;
  readonly lists: readonly ListItem[];
  readonly status: SyncStatus;
  readonly lastSync: number | null;
  readonly pending: number;
}

export type AddResult = { readonly kind: "ok"; readonly href: string };

export type AttachResult = { readonly kind: "ok" } | { readonly kind: "too-large" };

export interface ImportPreview {
  readonly result: ImportResult;
  /** Items whose UID already exists; importing replaces them. */
  readonly replacing: number;
}

export type LogoutChoice = "delete" | "keep" | "discard";

export class AppService extends EventTarget implements ErrorSink {
  readonly reporter: ErrorReporter;
  private store: AccountStore | null = null;
  private account: AccountRecord | null = null;
  private current: Snapshot;
  private syncState: "idle" | "syncing" | "offline" | "expired" | "error" = "idle";
  private channel: BroadcastChannel | null = null;
  /** Orphaned steps already reported in this session (avoids a report on every refresh). */
  private readonly reportedOrphans = new Set<string>();

  private constructor(
    readonly config: AppConfig,
    private readonly meta: MetaStore,
    settings: Settings,
  ) {
    super();
    this.reporter = new ErrorReporter(this);
    this.current = {
      account: null,
      settings,
      lists: [],
      status: { kind: "local" },
      lastSync: null,
      pending: 0,
    };
  }

  /** Returns `null` when IndexedDB is not usable (private window, blocked storage). */
  static async start(basePath: string): Promise<AppService | null> {
    setBasePath(basePath);
    if (!(await usable())) return null;
    const config = parseConfig(await staticJson("config.json"));
    const meta = await MetaStore.open();
    const settings = await meta.settings();
    const app = new AppService(config, meta, settings);
    if (settings.activeAccount !== null) {
      const account = await meta.account(settings.activeAccount);
      if (account === null) {
        throw new HakenError("app", "Active account has no record", {
          account: settings.activeAccount,
        });
      }
      await app.activate(account);
    }
    await app.refresh();
    return app;
  }

  get snapshot(): Snapshot {
    return this.current;
  }

  get activeAccount(): AccountRecord | null {
    return this.account;
  }

  // ------------------------------------------------------------ lifecycle

  private async activate(account: AccountRecord): Promise<void> {
    this.store?.close();
    this.channel?.close();
    this.account = account;
    this.store = await AccountStore.open(account.id);
    this.channel = new BroadcastChannel(`haken-${account.id}`);
    this.channel.onmessage = () => {
      this.refresh().catch((e: unknown) => this.reporter.report(e, "app.broadcast"));
    };
  }

  private requireStore(): AccountStore {
    if (this.store === null) throw new HakenError("app", "No active account");
    return this.store;
  }

  private requireAccount(): AccountRecord {
    if (this.account === null) throw new HakenError("app", "No active account");
    return this.account;
  }

  private get isServer(): boolean {
    return this.account?.type === "server";
  }

  /** Rebuilds the snapshot from the store and notifies the UI. */
  async refresh(): Promise<void> {
    const settings = await this.meta.settings();
    if (this.store === null || this.account === null) {
      this.current = {
        account: null,
        settings,
        lists: [],
        status: { kind: "local" },
        lastSync: null,
        pending: 0,
      };
      this.dispatchEvent(new Event("change"));
      return;
    }
    const [lists, tasks, outbox, conflicts] = await Promise.all([
      this.store.lists(),
      this.store.tasks(),
      this.store.outbox(),
      this.store.conflicts(),
    ]);
    const lastSync = await this.store.state("lastSync");
    const tooLarge = new Set<string>();
    for (const [key, value] of await this.store.allState()) {
      if (key.startsWith("tooLarge:") && value !== null)
        tooLarge.add(key.slice("tooLarge:".length));
    }
    const pending = outbox.length;
    const pendingHrefs = new Set(outbox.map((o) => o.href));
    const built = buildLists(lists, tasks, conflicts, pendingHrefs, tooLarge);
    this.current = {
      account: this.account,
      settings,
      lists: built.lists,
      status: this.statusFor(pending),
      lastSync: typeof lastSync === "number" ? lastSync : null,
      pending,
    };
    for (const orphan of built.orphans) {
      if (this.reportedOrphans.has(orphan)) continue;
      this.reportedOrphans.add(orphan);
      void this.reporter.report(
        new InvalidInputError("domain", "RELATED-TO points to a missing parent", {
          property: "RELATED-TO",
          uid: orphan,
        }),
        "app.snapshot",
      );
    }
    this.dispatchEvent(new Event("change"));
  }

  private statusFor(count: number): SyncStatus {
    if (!this.isServer) return { kind: "local" };
    switch (this.syncState) {
      case "syncing":
        return { kind: "syncing", count };
      case "offline":
        return { kind: "offline", count };
      case "expired":
        return { kind: "signin", count };
      case "error":
        return { kind: "error", count };
      case "idle":
        return count === 0 ? { kind: "synced" } : { kind: "pending", count };
    }
  }

  /**
   * Commits and refreshes. `edited` schedules a sync 2 s later; error tasks
   * pass `false` so a failing sync cannot re-trigger itself through its own
   * error task.
   */
  private async changed(changes: Changes, triggerSync = true): Promise<void> {
    await this.requireStore().commit(changes);
    this.channel?.postMessage("changed");
    await this.refresh();
    if (this.isServer && triggerSync) this.dispatchEvent(new Event("edited"));
  }

  // ------------------------------------------------------------ settings

  async setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Promise<void> {
    await this.meta.set(key, value);
    await this.refresh();
  }

  // ------------------------------------------------------------ setup and accounts

  async setSetupStep(step: SetupStep | null): Promise<void> {
    await this.setSetting("setupStep", step);
  }

  async createLocalAccount(): Promise<void> {
    const account: AccountRecord = {
      schema: SCHEMA,
      id: `local-${crypto.randomUUID()}`,
      type: "local",
      user: null,
      origin: null,
      createdAt: Date.now(),
      ready: false,
    };
    await this.meta.putAccount(account, true);
    await this.activate(account);
    await this.createList(DEFAULT_LIST);
  }

  /** Signs in and prepares the account (lists, initial pull). */
  async signIn(user: string, password: string): Promise<api.Login> {
    const result = await api.login(user, password);
    if (result.kind !== "ok") return result;
    const origin = location.origin;
    const id = `server-${hex(`${origin}|${user}`)}`;
    const existing = await this.meta.account(id);
    const account: AccountRecord = existing ?? {
      schema: SCHEMA,
      id,
      type: "server",
      user,
      origin,
      createdAt: Date.now(),
      ready: false,
    };
    await this.meta.putAccount(account, true);
    await this.activate(account);
    this.syncState = "idle";
    if (existing === null) {
      const lists = await caldav.listCollections(homeOf(user));
      if (lists.length === 0) await this.createList(DEFAULT_LIST);
    }
    await this.syncNow();
    return result;
  }

  /** New session for the active server account after the old one expired (*Sign in to sync*). */
  async reauthenticate(password: string): Promise<api.Login> {
    const account = this.requireAccount();
    if (account.type !== "server" || account.user === null) {
      throw new HakenError("app", "Re-authentication without server account");
    }
    const result = await api.login(account.user, password);
    if (result.kind === "ok") {
      this.syncState = "idle";
      await this.syncNow();
    }
    return result;
  }

  async finishSetup(): Promise<void> {
    const account = this.requireAccount();
    const ready: AccountRecord = { ...account, ready: true };
    await this.meta.putAccount(ready, true);
    this.account = ready;
    await this.meta.set("setupStep", null);
    await this.refresh();
  }

  /** Final sync attempt before logout; returns the number of changes still pending. */
  async prepareLogout(): Promise<number> {
    if (this.isServer) await this.syncNow();
    return (await this.requireStore().outbox()).length;
  }

  async logout(choice: LogoutChoice): Promise<void> {
    const account = this.requireAccount();
    const pending = (await this.requireStore().outbox()).length;
    if (choice === "delete" && pending > 0) {
      throw new HakenError("app", "Logout with delete while changes are pending", { pending });
    }
    if (account.type === "server") await api.logout();
    this.store?.close();
    this.channel?.close();
    this.store = null;
    this.channel = null;
    this.account = null;
    this.syncState = "idle";
    if (choice === "keep") {
      await this.meta.set("activeAccount", null);
    } else {
      await AccountStore.destroy(account.id);
      await this.meta.deleteAccount(account.id);
    }
    await this.meta.set("setupStep", "mode");
    await this.refresh();
  }

  // ------------------------------------------------------------ sync

  private syncing: Promise<void> | null = null;

  syncNow(): Promise<void> {
    if (!this.isServer) return Promise.resolve();
    if (this.syncing !== null) return this.syncing;
    this.syncing = this.runSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  private async runSync(): Promise<void> {
    const account = this.requireAccount();
    const store = this.requireStore();
    if (account.user === null)
      throw new HakenError("app", "Server account without user", { account: account.id });
    this.syncState = "syncing";
    await this.refresh();
    const runner = new SyncRunner(store, account.user, {
      onInvalid: async (info) => {
        await this.reporter.report(info.error, "sync.pull");
      },
      onNotice: (notice) =>
        this.dispatchEvent(new CustomEvent<Notice>("notice", { detail: notice })),
      onChange: () => this.channel?.postMessage("changed"),
    });
    try {
      const result = await runner.run();
      this.syncState = result === "offline" ? "offline" : result === "expired" ? "expired" : "idle";
    } catch (error) {
      this.syncState = "error";
      await this.refresh();
      await this.reporter.report(error, "sync.run");
      return;
    }
    await this.refresh();
  }

  get syncResult(): "idle" | "syncing" | "offline" | "expired" | "error" {
    return this.syncState;
  }

  // ------------------------------------------------------------ lists

  async createList(name: string): Promise<string> {
    const account = this.requireAccount();
    const trimmed = name.trim();
    if (trimmed === "") throw new HakenError("app", "Empty list name");
    const id = crypto.randomUUID();
    const href =
      account.type === "server" && account.user !== null
        ? `${homeOf(account.user)}${id}/`
        : `/local/${id}/`;
    const list: ListRecord = {
      schema: SCHEMA,
      href,
      displayName: trimmed,
      color: null,
      order: null,
      syncToken: null,
      state: account.type === "server" ? "new" : "synced",
      deleted: false,
    };
    await this.changed({
      putLists: [list],
      addOps:
        account.type === "server"
          ? [{ kind: "mkcalendar", href, groups: [], editedAt: Date.now() }]
          : [],
    });
    return href;
  }

  async renameList(href: string, name: string): Promise<void> {
    const list = await this.listRecord(href);
    const trimmed = name.trim();
    if (trimmed === "" || trimmed === list.displayName) return;
    await this.changed({
      putLists: [{ ...list, displayName: trimmed }],
      addOps:
        this.isServer && list.state === "synced"
          ? [{ kind: "proppatch", href, groups: ["displayName"], editedAt: Date.now() }]
          : [],
    });
  }

  async deleteList(href: string): Promise<void> {
    const store = this.requireStore();
    const list = await this.listRecord(href);
    const tasks = (await store.tasks()).filter((t) => t.list === href);
    const outbox = await store.outbox();
    const conflicts = (await store.conflicts())
      .filter((c) => tasks.some((t) => t.href === c.href))
      .map((c) => c.id);
    if (!this.isServer || list.state === "new") {
      await this.changed({
        deleteLists: [href],
        deleteTasks: tasks.map((t) => t.href),
        deleteBase: tasks.map((t) => t.href),
        deleteOps: outbox
          .filter((o) => o.href === href || tasks.some((t) => t.href === o.href))
          .map((o) => o.id),
        deleteConflicts: conflicts,
      });
      return;
    }
    const now = Date.now();
    await this.changed({
      putLists: [{ ...list, deleted: true }],
      putTasks: tasks
        .filter((t) => !t.deleted && t.invalid === null)
        .map((t) => ({ ...t, deleted: true })),
      addOps: [
        ...tasks
          .filter((t) => !t.deleted && t.invalid === null)
          .map((t) => ({ kind: "delete" as const, href: t.href, groups: [], editedAt: now })),
        { kind: "deletelist", href, groups: [], editedAt: now },
      ],
    });
  }

  private async listRecord(href: string): Promise<ListRecord> {
    const list = (await this.requireStore().lists()).find((l) => l.href === href);
    if (list === undefined) throw new HakenError("app", "Unknown list", { path: href });
    return list;
  }

  // ------------------------------------------------------------ tasks

  async addTask(
    listHref: string,
    summary: string,
    options: {
      readonly important?: boolean;
      readonly due?: Due | null;
      readonly parentHref?: string;
    } = {},
  ): Promise<AddResult> {
    const trimmed = summary.trim();
    if (trimmed === "") throw new HakenError("app", "Empty task title");
    const list = this.current.lists.find((l) => l.href === listHref);
    if (list === undefined) throw new HakenError("app", "Unknown list", { path: listHref });
    const uid = crypto.randomUUID();
    const now = new Date();
    let parentUid: string | null = null;
    let sortOrder: number;
    if (options.parentHref !== undefined) {
      const parent = list.tasks.find((t) => t.href === options.parentHref);
      if (parent === undefined || parent.view === null) {
        throw new HakenError("app", "Unknown parent task", { path: options.parentHref });
      }
      parentUid = parent.view.uid;
      sortOrder = orderAtEnd(viewsOf(parent.steps), appleSeconds(now));
    } else {
      sortOrder = orderOnTop(
        viewsOf(list.tasks.filter((t) => t.view !== null && !t.view.done)),
        appleSeconds(now),
      );
    }
    const ics = createTask(
      {
        uid,
        summary: trimmed,
        sortOrder,
        parentUid,
        important: options.important ?? false,
        due: options.due ?? null,
      },
      now,
    );
    const href = `${listHref}${uid}.ics`;
    const record: TaskRecord = {
      schema: SCHEMA,
      href,
      list: listHref,
      uid,
      ics,
      etag: null,
      deleted: false,
      invalid: null,
    };
    await this.changed({
      putTasks: [record],
      addOps: this.isServer
        ? [{ kind: "put", href, groups: resourceGroups(ics), editedAt: now.getTime() }]
        : [],
      expect: [{ href, ics: null }],
    });
    return { kind: "ok", href };
  }

  async edit(href: string, edit: TaskEdit): Promise<void> {
    const record = await this.taskRecord(href);
    const now = new Date();
    const result = applyEdit(record.ics, edit, now);
    if (result.groups.length === 0) return;
    await this.changed({
      putTasks: [{ ...record, ics: result.ics }],
      addOps: this.isServer
        ? [{ kind: "put", href, groups: result.groups, editedAt: now.getTime() }]
        : [],
      expect: [{ href, ics: record.ics }],
    });
  }

  async deleteTask(href: string): Promise<void> {
    const store = this.requireStore();
    const record = await this.taskRecord(href);
    const uid = record.uid;
    const all = (await store.tasks()).filter((t) => t.list === record.list && !t.deleted);
    const steps = all.filter(
      (t) => t.invalid === null && readTask(parseResource(t.ics)).parentUid === uid,
    );
    const targets = [record, ...steps];
    const hrefs = targets.map((t) => t.href);
    const conflicts = (await store.conflicts())
      .filter((c) => hrefs.includes(c.href))
      .map((c) => c.id);
    if (!this.isServer) {
      await this.changed({ deleteTasks: hrefs, deleteConflicts: conflicts });
      return;
    }
    const now = Date.now();
    await this.changed({
      putTasks: targets.map((t) => ({ ...t, deleted: true })),
      addOps: targets.map((t) => ({
        kind: "delete" as const,
        href: t.href,
        groups: [],
        editedAt: now,
      })),
      deleteConflicts: conflicts,
    });
  }

  /** Moves an open top-level task (or a step among its siblings) to `targetIndex`. */
  async move(href: string, targetIndex: number): Promise<void> {
    const item = this.findItem(href);
    if (item === null || item.view === null)
      throw new HakenError("app", "Unknown task", { path: href });
    const list = this.current.lists.find((l) => l.href === item.list);
    if (list === undefined) throw new HakenError("app", "Unknown list", { path: item.list });
    const siblings =
      item.view.parentUid === null
        ? list.tasks.filter((t) => t.view !== null && !t.view.done)
        : (list.tasks.find((t) => t.view?.uid === item.view?.parentUid)?.steps ?? []);
    const sorted = viewsOf(siblings).sort(compareTasks);
    const moves = reorder(sorted, item.view.uid, targetIndex);
    if (moves.length === 0) return;
    const store = this.requireStore();
    const now = new Date();
    const putTasks: TaskRecord[] = [];
    const expect: { href: string; ics: string }[] = [];
    const addOps: { kind: "put"; href: string; groups: string[]; editedAt: number }[] = [];
    for (const move of moves) {
      const target = siblings.find((s) => s.view?.uid === move.uid);
      if (target === undefined)
        throw new HakenError("app", "Reorder target missing", { uid: move.uid });
      const record = await store.task(target.href);
      if (record === null)
        throw new HakenError("app", "Reorder record missing", { path: target.href });
      const result = applyEdit(record.ics, { kind: "sortOrder", value: move.sortOrder }, now);
      if (result.groups.length === 0) continue;
      putTasks.push({ ...record, ics: result.ics });
      expect.push({ href: record.href, ics: record.ics });
      if (this.isServer)
        addOps.push({
          kind: "put",
          href: record.href,
          groups: [...result.groups],
          editedAt: now.getTime(),
        });
    }
    await this.changed({ putTasks, expect, addOps });
  }

  async useConflict(id: number): Promise<void> {
    const conflict = await this.conflict(id);
    if (conflict.group === "*")
      throw new HakenError("app", "Whole-resource notes cannot be applied", { id });
    const record = await this.taskRecord(conflict.href);
    const now = new Date();
    const result = applyEdit(
      record.ics,
      { kind: "restoreGroup", group: conflict.group, lines: conflict.lines },
      now,
    );
    await this.changed({
      putTasks: result.groups.length > 0 ? [{ ...record, ics: result.ics }] : [],
      addOps:
        this.isServer && result.groups.length > 0
          ? [
              {
                kind: "put",
                href: record.href,
                groups: [...result.groups],
                editedAt: now.getTime(),
              },
            ]
          : [],
      deleteConflicts: [id],
      expect: [{ href: record.href, ics: record.ics }],
    });
  }

  async dismissConflict(id: number): Promise<void> {
    await this.conflict(id);
    await this.changed({ deleteConflicts: [id] });
  }

  private async conflict(id: number): Promise<ConflictRecord> {
    const c = (await this.requireStore().conflicts()).find((x) => x.id === id);
    if (c === undefined) throw new HakenError("app", "Unknown conflict note", { id });
    return c;
  }

  async attach(href: string, file: File): Promise<AttachResult> {
    if (file.size > ATTACHMENT_LIMIT) return { kind: "too-large" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    await this.edit(href, {
      kind: "addAttachment",
      filename: file.name === "" ? "attachment" : file.name,
      mediaType: file.type === "" ? "application/octet-stream" : file.type,
      base64: bytesToBase64(bytes),
    });
    return { kind: "ok" };
  }

  async attachmentBlob(href: string, index: number): Promise<{ blob: Blob; filename: string }> {
    const record = await this.taskRecord(href);
    const data = attachmentData(parseResource(record.ics), index);
    const copy = new Uint8Array(data.bytes);
    return {
      blob: new Blob([copy], { type: data.mediaType ?? "application/octet-stream" }),
      filename: data.filename ?? "attachment",
    };
  }

  private async taskRecord(href: string): Promise<TaskRecord> {
    const record = await this.requireStore().task(href);
    if (record === null || record.deleted)
      throw new HakenError("app", "Unknown task", { path: href });
    if (record.invalid !== null)
      throw new HakenError("app", "Task cannot be read and is read-only", { path: href });
    return record;
  }

  findItem(href: string): TaskItem | null {
    for (const list of this.current.lists) {
      for (const t of list.tasks) {
        if (t.href === href) return t;
        for (const s of t.steps) if (s.href === href) return s;
      }
    }
    return null;
  }

  // ------------------------------------------------------------ import / export

  async exportIcs(): Promise<string> {
    const tasks = (await this.requireStore().tasks()).filter(
      (t) => !t.deleted && t.invalid === null,
    );
    return joinIcsFile(tasks.map((t) => t.ics));
  }

  /** Only resources with pending changes (logout with unsynced work). */
  async exportPendingIcs(): Promise<string> {
    const store = this.requireStore();
    const hrefs = new Set((await store.outbox()).map((o) => o.href));
    const tasks = (await store.tasks()).filter(
      (t) => hrefs.has(t.href) && !t.deleted && t.invalid === null,
    );
    return joinIcsFile(tasks.map((t) => t.ics));
  }

  async previewImport(text: string): Promise<ImportPreview> {
    const result = splitIcsFile(text);
    const existing = new Set(
      (await this.requireStore().tasks()).filter((t) => !t.deleted).map((t) => t.uid),
    );
    if (result.problems.length > 0) {
      await this.reporter.report(
        new InvalidInputError("domain", "Import contains invalid items", {
          property: result.problems.map((p) => p.property).join(","),
          count: result.problems.length,
        }),
        "app.import",
      );
    }
    return { result, replacing: result.items.filter((i) => existing.has(i.view.uid)).length };
  }

  async confirmImport(listHref: string, preview: ImportPreview): Promise<void> {
    const store = this.requireStore();
    await this.listRecord(listHref);
    const byUid = new Map((await store.tasks()).filter((t) => !t.deleted).map((t) => [t.uid, t]));
    const now = Date.now();
    const putTasks: TaskRecord[] = [];
    const expect: { href: string; ics: string | null }[] = [];
    const addOps: { kind: "put"; href: string; groups: string[]; editedAt: number }[] = [];
    for (const item of preview.result.items) {
      const existing = byUid.get(item.view.uid);
      if (existing !== undefined) {
        if (existing.invalid !== null) {
          throw new HakenError("app", "Import would replace an unreadable task", {
            uid: existing.uid,
          });
        }
        putTasks.push({ ...existing, ics: item.ics });
        expect.push({ href: existing.href, ics: existing.ics });
        if (this.isServer)
          addOps.push({
            kind: "put",
            href: existing.href,
            groups: resourceGroups(item.ics),
            editedAt: now,
          });
        continue;
      }
      const name = /^[A-Za-z0-9._-]{1,200}$/.test(item.view.uid)
        ? item.view.uid
        : crypto.randomUUID();
      const href = `${listHref}${name}.ics`;
      putTasks.push({
        schema: SCHEMA,
        href,
        list: listHref,
        uid: item.view.uid,
        ics: item.ics,
        etag: null,
        deleted: false,
        invalid: null,
      });
      expect.push({ href, ics: null });
      if (this.isServer)
        addOps.push({ kind: "put", href, groups: resourceGroups(item.ics), editedAt: now });
    }
    await this.changed({ putTasks, expect, addOps });
  }

  // ------------------------------------------------------------ ErrorSink

  async writeErrorTask(report: ErrorReport, print: string): Promise<boolean> {
    if (this.store === null) return false;
    const store = this.store;
    const settings = await this.meta.settings();
    const today = new Date().toISOString().slice(0, 10);
    let list = (await store.lists()).find((l) => l.displayName === ERRORLOGS && !l.deleted);
    const tasks = await store.tasks();
    if (list !== undefined) {
      const listHref = list.href;
      const open = tasks.find(
        (t) =>
          t.list === listHref &&
          !t.deleted &&
          t.invalid === null &&
          fingerprintOf(t.ics) === print &&
          !readTask(parseResource(t.ics)).done,
      );
      if (open !== undefined) {
        const now = new Date();
        const ics = bumpErrorTask(open.ics, report, now);
        await this.changed(
          {
            putTasks: [{ ...open, ics }],
            addOps: this.isServer
              ? [
                  {
                    kind: "put",
                    href: open.href,
                    groups: ["DESCRIPTION", "X-HAKEN-ERROR-COUNT"],
                    editedAt: now.getTime(),
                  },
                ]
              : [],
            expect: [{ href: open.href, ics: open.ics }],
          },
          false,
        );
        return true;
      }
    }
    const count = settings.errorDay === today ? settings.errorCount : 0;
    if (count >= ERROR_TASKS_PER_DAY) return false;
    if (list === undefined) {
      const href = await this.createList(ERRORLOGS);
      list = await this.listRecord(href);
    }
    const uid = crypto.randomUUID();
    const now = new Date();
    const ics = createErrorTask(uid, report, print, appleSeconds(now), now);
    const href = `${list.href}${uid}.ics`;
    await this.meta.set("errorDay", today);
    await this.meta.set("errorCount", count + 1);
    await this.changed(
      {
        putTasks: [
          {
            schema: SCHEMA,
            href,
            list: list.href,
            uid,
            ics,
            etag: null,
            deleted: false,
            invalid: null,
          },
        ],
        addOps: this.isServer
          ? [{ kind: "put", href, groups: resourceGroups(ics), editedAt: now.getTime() }]
          : [],
        expect: [{ href, ics: null }],
      },
      false,
    );
    return true;
  }

  async countRecursion(): Promise<void> {
    const settings = await this.meta.settings();
    await this.meta.set("errorRecursions", settings.errorRecursions + 1);
  }

  environment(): Readonly<Record<string, string | number | boolean>> {
    return {
      "App version": APP_VERSION,
      "Time (UTC)": new Date().toISOString(),
      "User agent": navigator.userAgent,
      Online: navigator.onLine,
      "Account type": this.account?.type ?? "none",
      "Outbox length": this.current.pending,
    };
  }
}

// ---------------------------------------------------------------- snapshot building

function viewsOf(items: readonly TaskItem[]): TaskView[] {
  return items.flatMap((i) => (i.view === null ? [] : [i.view]));
}

function buildLists(
  lists: readonly ListRecord[],
  tasks: readonly TaskRecord[],
  conflicts: readonly ConflictRecord[],
  pending: ReadonlySet<string>,
  tooLarge: ReadonlySet<string>,
): { lists: ListItem[]; orphans: string[] } {
  const orphans: string[] = [];
  const out: ListItem[] = [];
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  for (const list of lists) {
    if (list.deleted) continue;
    const items: (TaskItem & { parentUid: string | null })[] = [];
    for (const t of tasks) {
      if (t.list !== list.href || t.deleted) continue;
      let view: TaskView | null = null;
      if (t.invalid === null) view = readTask(parseResource(t.ics));
      items.push({
        href: t.href,
        list: t.list,
        view,
        invalid: t.invalid,
        steps: [],
        conflicts: conflicts.filter((c) => c.href === t.href),
        pending: pending.has(t.href),
        tooLarge: tooLarge.has(t.href),
        parentUid: view?.parentUid ?? null,
      });
    }
    const byUid = new Map(items.filter((i) => i.view !== null).map((i) => [i.view?.uid ?? "", i]));
    const steps = new Map<string, TaskItem[]>();
    const top: (TaskItem & { parentUid: string | null })[] = [];
    for (const item of items) {
      if (item.parentUid !== null && byUid.has(item.parentUid)) {
        const bucket = steps.get(item.parentUid) ?? [];
        bucket.push(item);
        steps.set(item.parentUid, bucket);
      } else {
        if (item.parentUid !== null) orphans.push(item.view?.uid ?? item.href);
        top.push(item);
      }
    }
    const withSteps = top.map((t): TaskItem => {
      const own = t.view === null ? [] : (steps.get(t.view.uid) ?? []);
      return { ...stripParent(t), steps: own.sort(byOrder) };
    });
    const open = withSteps.filter((t) => t.view === null || !t.view.done).sort(byOrder);
    const done = withSteps
      .filter((t) => t.view?.done === true)
      .sort((a, b) => (b.view?.completedAt ?? 0) - (a.view?.completedAt ?? 0));
    out.push({
      href: list.href,
      name: list.displayName,
      color: list.color,
      errorlogs: list.displayName === ERRORLOGS,
      tasks: [...open, ...done],
      openCount: open.length,
    });
  }
  out.sort((a, b) => {
    if (a.errorlogs !== b.errorlogs) return a.errorlogs ? 1 : -1;
    const la = lists.find((l) => l.href === a.href)?.order ?? null;
    const lb = lists.find((l) => l.href === b.href)?.order ?? null;
    if (la !== null && lb !== null && la !== lb) return la - lb;
    if ((la === null) !== (lb === null)) return la === null ? 1 : -1;
    return collator.compare(a.name, b.name);
  });
  return { lists: out, orphans };
}

function stripParent(item: TaskItem & { parentUid: string | null }): TaskItem {
  const { parentUid: _ignored, ...rest } = item;
  return rest;
}

function byOrder(a: TaskItem, b: TaskItem): number {
  if (a.view === null || b.view === null) return a.view === null ? 1 : -1;
  return compareTasks(a.view, b.view);
}

/** Stable, non-secret account id from origin and user (FNV-1a 32 bit, twice). */
function hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (const byte of new TextEncoder().encode(input)) {
    h1 = Math.imul(h1 ^ byte, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ byte, 0x811c9dc5) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export { UnreachableError };
