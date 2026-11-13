/**
 * Application service: the only API the UI uses. Commands write the local
 * store (task + outbox entry in one transaction) and return after the data
 * is on disk; sync runs separately. Queries are snapshots rebuilt from the
 * store after every change.
 */
import { byCodeUnit } from "../domain/compare.js";
import { type AppConfig, parseConfig } from "../domain/config.js";
import { HakenError, InvalidInputError } from "../domain/errors.js";
import {
  bumpErrorTask,
  createErrorTask,
  ERRORLOGS,
  type ErrorReport,
  fingerprintOf,
} from "../domain/errortask.js";
import { asFocusOrder, type FocusPart } from "../domain/focus.js";
import { type ImportResult, joinIcsFile, splitIcsFile } from "../domain/icsfile.js";
import { asLabelOrder, relabelOrder } from "../domain/labels.js";
import { compareTasks, orderAtEnd, orderOnTop, type Reorder, reorder } from "../domain/order.js";
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
import { setBasePath, staticJson } from "../net/http.js";
import { AccountStore, type Changes, StaleError } from "../store/account.js";
import { usable } from "../store/idb.js";
import { MetaStore, type Settings } from "../store/meta.js";
import {
  type AccountRecord,
  type ConflictRecord,
  type ListRecord,
  type OutboxInput,
  SCHEMA,
  type SetupStep,
  type TaskRecord,
} from "../store/records.js";
import { homeOf, type Notice, QUARANTINE, quarantinedHref, SyncRunner } from "../sync/runner.js";
import { APP_VERSION, ErrorReporter, type ErrorSink } from "./errors.js";

export type { Frequency, Recurrence, Weekday } from "../domain/recurrence.js";
export type { Theme } from "../store/meta.js";
export type { SetupStep } from "../store/records.js";
export type { Notice } from "../sync/runner.js";

export const DEFAULT_LIST = "Haken";
export const ATTACHMENT_LIMIT = 5 * 1024 * 1024;
/** The gateway's request body limit (`proxy.MaxBody`): a whole task resource must fit. */
export const RESOURCE_LIMIT = 32 * 1024 * 1024;
/** Room for the ATTACH parameters and line folding (3 bytes per 75). */
const ATTACH_OVERHEAD = 1024;
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
  /** Items sync skips after an unexpected error (ADR-20261104-sync-quarantine). */
  | { readonly kind: "quarantined"; readonly count: number }
  | { readonly kind: "syncing"; readonly count: number }
  | { readonly kind: "offline"; readonly count: number }
  | { readonly kind: "signin"; readonly count: number }
  | { readonly kind: "error"; readonly count: number };

export interface Snapshot {
  readonly account: AccountRecord | null;
  readonly settings: Settings;
  readonly lists: readonly ListItem[];
  /** Manual label order on this device (ADR-20261111-label-order). */
  readonly labelOrder: readonly string[];
  readonly status: SyncStatus;
  readonly lastSync: number | null;
  readonly pending: number;
  /** Task and list paths sync skips (ADR-20261104-sync-quarantine), sorted. */
  readonly quarantined: readonly string[];
}

export type AddResult = { readonly kind: "ok"; readonly href: string };

export interface AddOptions {
  readonly important?: boolean;
  readonly due?: Due | null;
  readonly parentHref?: string;
  /** Put the new tasks on *Focus* (`YYYY-MM-DD`). */
  readonly focus?: string | null;
  /** Labels of the new tasks (`CATEGORIES`). */
  readonly categories?: readonly string[];
}

export type AttachResult =
  | { readonly kind: "ok" }
  /** The file is over `ATTACHMENT_LIMIT`. */
  | { readonly kind: "too-large" }
  /** The task with the file would be over `RESOURCE_LIMIT`. */
  | { readonly kind: "task-too-large" };

export interface ImportPreview {
  readonly result: ImportResult;
  /** Items whose UID already exists; importing replaces them. */
  readonly replacing: number;
}

const LABEL_ORDER = "labelOrder";

function invalidLabelOrder(cause?: unknown): InvalidInputError {
  return new InvalidInputError(
    "store",
    "Stored state has an unexpected value",
    { store: "state", key: LABEL_ORDER },
    { cause },
  );
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
      labelOrder: [],
      status: { kind: "local" },
      lastSync: null,
      pending: 0,
      quarantined: [],
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
        labelOrder: [],
        status: { kind: "local" },
        lastSync: null,
        pending: 0,
        quarantined: [],
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
    const labelOrder = await this.labelOrder();
    const tooLarge = new Set<string>();
    const quarantined = new Set<string>();
    for (const [key, value] of await this.store.allState()) {
      if (key.startsWith("tooLarge:") && value !== null)
        tooLarge.add(key.slice("tooLarge:".length));
      if (key.startsWith(QUARANTINE) && value !== null) quarantined.add(quarantinedHref(key));
    }
    const pending = outbox.length;
    const pendingHrefs = new Set(outbox.map((o) => o.href));
    const built = buildLists(lists, tasks, conflicts, pendingHrefs, tooLarge);
    this.current = {
      account: this.account,
      settings,
      lists: built.lists,
      labelOrder,
      status: this.statusFor(pending, quarantined.size),
      lastSync: typeof lastSync === "number" ? lastSync : null,
      pending,
      quarantined: [...quarantined].sort(byCodeUnit),
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

  private statusFor(count: number, quarantined: number): SyncStatus {
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
        if (quarantined > 0) return { kind: "quarantined", count: quarantined };
        return count === 0 ? { kind: "synced" } : { kind: "pending", count };
    }
  }

  /** Tail of the command queue: commands run one after another, never interleaved. */
  private tail: Promise<unknown> = Promise.resolve();

  /**
   * Runs one command after the previous one finished. A command that loses a
   * race against sync (`StaleError`) runs again on the fresh state: every
   * command reads what it changes, so re-running it is correct. At most 3 times.
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await fn();
        } catch (error) {
          if (!(error instanceof StaleError) || attempt >= 3) throw error;
        }
      }
    };
    const result = this.tail.then(run, run);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
    if (result.kind === "ok") await this.prepareServerAccount(user);
    return result;
  }

  private async prepareServerAccount(user: string): Promise<void> {
    const origin = location.origin;
    const key = `${origin}|${user}`;
    const id = `server-${hex(key)}`;
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
      const found = await caldav.listCollections(homeOf(user));
      if (found.lists.length === 0 && found.invalid.length === 0)
        await this.createList(DEFAULT_LIST);
    }
    await this.syncNow();
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
    // Notices name tasks by their current title: they go out after the snapshot shows the run.
    const notices: Notice[] = [];
    const announce = (): void => {
      for (const notice of notices.splice(0))
        this.dispatchEvent(new CustomEvent<Notice>("notice", { detail: notice }));
    };
    const runner = new SyncRunner(store, account.user, {
      onInvalid: async (info) => {
        await this.reporter.report(info.error, "sync.pull");
      },
      onQuarantine: async (info) => {
        await this.reporter.report(info.error, `sync.quarantine ${info.href}`);
      },
      onNotice: (notice) => notices.push(notice),
      onChange: () => this.channel?.postMessage("changed"),
    });
    try {
      const result = await runner.run();
      this.syncState = result === "offline" || result === "expired" ? result : "idle";
    } catch (error) {
      this.syncState = "error";
      await this.refresh();
      announce();
      await this.reporter.report(error, "sync.run");
      return;
    }
    await this.refresh();
    announce();
  }

  get syncResult(): "idle" | "syncing" | "offline" | "expired" | "error" {
    return this.syncState;
  }

  // ------------------------------------------------------------ lists

  createList(name: string): Promise<string> {
    return this.exclusive(() => this.createListNow(name));
  }

  private async createListNow(name: string): Promise<string> {
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

  renameList(href: string, name: string): Promise<void> {
    return this.exclusive(() => this.renameListNow(href, name));
  }

  private async renameListNow(href: string, name: string): Promise<void> {
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

  /**
   * Moves a list to `targetIndex` among the shown lists (errorlogs stays last).
   * The order is written as `calendar-order` 1…n; only lists whose order changes are patched.
   */
  moveList(href: string, targetIndex: number): Promise<void> {
    return this.exclusive(() => this.moveListNow(href, targetIndex));
  }

  private async moveListNow(href: string, targetIndex: number): Promise<void> {
    const shown = this.snapshot.lists.filter((l) => !l.errorlogs).map((l) => l.href);
    if (!shown.includes(href))
      throw new HakenError("app", "Moved list is not shown", { path: href });
    const rest = shown.filter((h) => h !== href);
    rest.splice(Math.max(0, Math.min(targetIndex, rest.length)), 0, href);
    const putLists: ListRecord[] = [];
    const addOps: OutboxInput[] = [];
    const lists = new Map((await this.requireStore().lists()).map((l) => [l.href, l]));
    for (const [i, h] of rest.entries()) {
      const list = lists.get(h);
      if (list === undefined) throw new HakenError("app", "Unknown list", { path: h });
      if (list.order === i + 1) continue;
      putLists.push({ ...list, order: i + 1 });
      if (this.isServer && list.state === "synced")
        addOps.push({ kind: "proppatch", href: h, groups: ["order"], editedAt: Date.now() });
    }
    if (putLists.length > 0) await this.changed({ putLists, addOps });
  }

  deleteList(href: string): Promise<void> {
    return this.exclusive(() => this.deleteListNow(href));
  }

  private async deleteListNow(href: string): Promise<void> {
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

  /**
   * Adds one task per summary in one transaction, in the given order: the
   * first ends up on top of the open tasks, steps are appended in order.
   */
  addTasks(
    listHref: string,
    summaries: readonly string[],
    options: AddOptions = {},
  ): Promise<AddResult[]> {
    return this.exclusive(() => this.addTasksNow(listHref, summaries, options));
  }

  private async addTasksNow(
    listHref: string,
    summaries: readonly string[],
    options: AddOptions,
  ): Promise<AddResult[]> {
    if (summaries.length === 0) throw new HakenError("app", "No task title");
    const titles = summaries.map((s) => s.trim());
    if (titles.includes("")) throw new HakenError("app", "Empty task title");
    const list = this.current.lists.find((l) => l.href === listHref);
    if (list === undefined) throw new HakenError("app", "Unknown list", { path: listHref });
    const now = new Date();
    const fallback = appleSeconds(now);
    let parentUid: string | null = null;
    let orderOf: (index: number) => number;
    if (options.parentHref !== undefined) {
      const parent = list.tasks.find((t) => t.href === options.parentHref);
      if (parent === undefined || parent.view === null) {
        throw new HakenError("app", "Unknown parent task", { path: options.parentHref });
      }
      parentUid = parent.view.uid;
      const first = orderAtEnd(viewsOf(parent.steps), fallback);
      orderOf = (index) => first + index;
    } else {
      const open = viewsOf(list.tasks.filter((t) => t.view !== null && !t.view.done));
      const last = orderOnTop(open, fallback);
      orderOf = (index) => last - (titles.length - 1 - index);
    }
    const records: TaskRecord[] = titles.map((summary, index) => {
      const uid = crypto.randomUUID();
      const ics = createTask(
        {
          uid,
          summary,
          sortOrder: orderOf(index),
          parentUid,
          important: options.important ?? false,
          due: options.due ?? null,
          focus: options.focus ?? null,
          categories: options.categories ?? [],
        },
        now,
      );
      return {
        schema: SCHEMA,
        href: `${listHref}${uid}.ics`,
        list: listHref,
        uid,
        ics,
        etag: null,
        deleted: false,
        invalid: null,
      };
    });
    await this.changed({
      putTasks: records,
      addOps: this.isServer
        ? records.map((r) => ({
            kind: "put" as const,
            href: r.href,
            groups: resourceGroups(r.ics),
            editedAt: now.getTime(),
          }))
        : [],
      expect: records.map((r) => ({ href: r.href, ics: null })),
    });
    return records.map((r) => ({ kind: "ok", href: r.href }));
  }

  edit(href: string, edit: TaskEdit): Promise<void> {
    return this.exclusive(() => this.editNow(href, edit));
  }

  private async editNow(href: string, edit: TaskEdit): Promise<void> {
    const record = await this.taskRecord(href);
    const now = new Date();
    const before = readTask(parseResource(record.ics));
    const result = applyEdit(record.ics, edit, now);
    if (result.groups.length === 0) return;
    const putTasks: TaskRecord[] = [{ ...record, ics: result.ics }];
    const expect: { href: string; ics: string }[] = [{ href, ics: record.ics }];
    const addOps: { kind: "put"; href: string; groups: string[]; editedAt: number }[] = [];
    if (this.isServer)
      addOps.push({ kind: "put", href, groups: [...result.groups], editedAt: now.getTime() });
    // Advanced: completed, but still open (the last occurrence completes for good).
    const advanced =
      edit.kind === "done" &&
      edit.value &&
      !before.done &&
      before.recurrence !== null &&
      !readTask(parseResource(result.ics)).done;
    if (advanced) {
      // The next occurrence starts with its checklist open again, in the same commit.
      for (const step of await this.stepRecords(record.list, before.uid)) {
        const reopened = applyEdit(step.ics, { kind: "done", value: false }, now);
        if (reopened.groups.length === 0) continue;
        putTasks.push({ ...step, ics: reopened.ics });
        expect.push({ href: step.href, ics: step.ics });
        if (this.isServer) {
          addOps.push({
            kind: "put",
            href: step.href,
            groups: [...reopened.groups],
            editedAt: now.getTime(),
          });
        }
      }
    }
    await this.changed({ putTasks, addOps, expect });
    if (advanced) this.dispatchEvent(new CustomEvent<string>("advanced", { detail: href }));
  }

  private async stepRecords(list: string, parentUid: string): Promise<TaskRecord[]> {
    return (await this.requireStore().tasks()).filter(
      (t) =>
        t.list === list &&
        !t.deleted &&
        t.invalid === null &&
        readTask(parseResource(t.ics)).parentUid === parentUid,
    );
  }

  deleteTask(href: string): Promise<void> {
    return this.exclusive(() => this.deleteTaskNow(href));
  }

  private async deleteTaskNow(href: string): Promise<void> {
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
  move(href: string, targetIndex: number): Promise<void> {
    return this.exclusive(() => this.moveNow(href, targetIndex));
  }

  private async moveNow(href: string, targetIndex: number): Promise<void> {
    const item = this.findItem(href);
    if (!item?.view) throw new HakenError("app", "Unknown task", { path: href });
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
    const pairs = await Promise.all(
      moves.map(async (move) => {
        const target = siblings.find((s) => s.view?.uid === move.uid);
        if (target === undefined)
          throw new HakenError("app", "Reorder target missing", { uid: move.uid });
        const record = await store.task(target.href);
        if (record === null)
          throw new HakenError("app", "Reorder record missing", { path: target.href });
        return { move, record };
      }),
    );
    for (const { move, record } of pairs) {
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

  /** Moves a task inside one part of *Focus*; `siblings` are that part's open tasks in shown order. */
  moveInFocus(
    href: string,
    part: FocusPart,
    siblingHrefs: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    return this.exclusive(() => this.moveInFocusNow(href, part, siblingHrefs, targetIndex));
  }

  private async moveInFocusNow(
    href: string,
    part: FocusPart,
    siblingHrefs: readonly string[],
    targetIndex: number,
  ): Promise<void> {
    const siblings = this.siblingItems(href, siblingHrefs);
    const views = asFocusOrder(viewsOf(siblings), part);
    await this.writeOrders(
      siblings,
      reorder(views, uidOf(siblings, href), targetIndex),
      "focusOrder",
    );
  }

  /**
   * Moves a task among the open tasks of a view across lists (a label view);
   * `siblingHrefs` are the view's open tasks. Writes `X-APPLE-SORT-ORDER`.
   */
  moveAmong(href: string, siblingHrefs: readonly string[], targetIndex: number): Promise<void> {
    return this.exclusive(async () => {
      const siblings = this.siblingItems(href, siblingHrefs);
      const views = viewsOf(siblings).sort(compareTasks);
      await this.writeOrders(
        siblings,
        reorder(views, uidOf(siblings, href), targetIndex),
        "sortOrder",
      );
    });
  }

  private siblingItems(href: string, siblingHrefs: readonly string[]): TaskItem[] {
    const siblings = siblingHrefs.map((h) => {
      const item = this.findItem(h);
      if (!item?.view) throw new HakenError("app", "Unknown task", { path: h });
      return item;
    });
    if (!siblings.some((s) => s.href === href))
      throw new HakenError("app", "Moved task is not among its siblings", { path: href });
    return siblings;
  }

  private async writeOrders(
    siblings: readonly TaskItem[],
    moves: readonly Reorder[],
    kind: "sortOrder" | "focusOrder",
  ): Promise<void> {
    const store = this.requireStore();
    const now = new Date();
    const changes: {
      putTasks: TaskRecord[];
      expect: { href: string; ics: string }[];
      addOps: OutboxInput[];
    } = {
      putTasks: [],
      expect: [],
      addOps: [],
    };
    const pairs = await Promise.all(
      moves.map(async (move) => {
        const target = siblings.find((s) => s.view?.uid === move.uid);
        const record = target === undefined ? null : await store.task(target.href);
        if (record === null)
          throw new HakenError("app", "Reorder record missing", { uid: move.uid });
        return { move, record };
      }),
    );
    for (const { move, record } of pairs) {
      const result = applyEdit(record.ics, { kind, value: move.sortOrder }, now);
      if (result.groups.length === 0) continue;
      changes.putTasks.push({ ...record, ics: result.ics });
      changes.expect.push({ href: record.href, ics: record.ics });
      if (this.isServer) {
        changes.addOps.push({
          kind: "put",
          href: record.href,
          groups: [...result.groups],
          editedAt: now.getTime(),
        });
      }
    }
    if (changes.putTasks.length > 0) await this.changed(changes);
  }

  /**
   * Moves a task with its checklist to another list. In CalDAV a list is the
   * collection the resource lives in, so this is a new resource in the target
   * list and a delete of the old one, with the same UID. The old copy is
   * deleted on the server only after the new one is confirmed (sync).
   */
  moveToList(href: string, targetList: string): Promise<string> {
    return this.exclusive(() => this.moveToListNow(href, targetList));
  }

  private async moveToListNow(href: string, targetList: string): Promise<string> {
    const store = this.requireStore();
    const record = await this.taskRecord(href);
    if (record.list === targetList) return href;
    const target = await this.listRecord(targetList);
    if (target.deleted) throw new HakenError("app", "Target list is deleted", { path: targetList });
    const view = readTask(parseResource(record.ics));
    if (view.parentUid !== null)
      throw new HakenError("app", "Only top-level tasks move between lists", { path: href });
    const now = new Date();
    const targetItem = this.current.lists.find((l) => l.href === targetList);
    const top = orderOnTop(
      viewsOf((targetItem?.tasks ?? []).filter((t) => t.view !== null && !t.view.done)),
      appleSeconds(now),
    );
    const steps = await this.stepRecords(record.list, view.uid);
    const putTasks: TaskRecord[] = [];
    const addOps: OutboxInput[] = [];
    const expect: { href: string; ics: string | null }[] = [];
    const conflicts = (await store.conflicts()).filter((c) =>
      [record, ...steps].some((r) => r.href === c.href),
    );
    const movedHref = (old: string) => `${targetList}${old.slice(old.lastIndexOf("/") + 1)}`;
    const newHref = movedHref(href);
    const all = [record, ...steps];
    const existing = await Promise.all(all.map((r) => store.task(movedHref(r.href))));
    const taken = all.find((_, i) => existing[i] !== null);
    if (taken !== undefined)
      throw new HakenError("app", "Target resource exists", { path: movedHref(taken.href) });
    for (const r of all) {
      const ics =
        r === record ? applyEdit(r.ics, { kind: "sortOrder", value: top }, now).ics : r.ics;
      const moved = movedHref(r.href);
      putTasks.push({ ...r, href: moved, list: targetList, ics, etag: null, deleted: false });
      expect.push({ href: moved, ics: null }, { href: r.href, ics: r.ics });
      if (this.isServer) {
        putTasks.push({ ...r, deleted: true });
        addOps.push(
          { kind: "put", href: moved, groups: resourceGroups(ics), editedAt: now.getTime() },
          { kind: "delete", href: r.href, groups: [], editedAt: now.getTime() },
        );
      }
    }
    // Conflict notes stay with the task: they move to its new path.
    await this.changed({
      putTasks,
      addOps,
      expect,
      deleteTasks: this.isServer ? [] : [record, ...steps].map((r) => r.href),
      deleteConflicts: conflicts.map((c) => c.id),
      addConflicts: conflicts.map(({ id: _id, schema: _schema, ...c }) => ({
        ...c,
        href: movedHref(c.href),
      })),
    });
    return newHref;
  }

  // ------------------------------------------------------------ labels

  /** The stored label order (`state` key `labelOrder`, a JSON array); `[]` = by name. */
  private async labelOrder(): Promise<string[]> {
    const stored = await this.requireStore().state(LABEL_ORDER);
    if (stored === null) return [];
    if (typeof stored !== "string") throw invalidLabelOrder();
    try {
      return asLabelOrder(JSON.parse(stored));
    } catch (error) {
      throw invalidLabelOrder(error);
    }
  }

  /** Stores the label order as shown after a move; on this device only (ADR-20261111-label-order). */
  setLabelOrder(order: readonly string[]): Promise<void> {
    return this.exclusive(() =>
      this.changed({ putState: { [LABEL_ORDER]: JSON.stringify(asLabelOrder(order)) } }, false),
    );
  }

  /**
   * Renames `label` on every task carrying it; a task that has `name` already
   * keeps it once (ADR-20261108-label-edit).
   */
  renameLabel(label: string, name: string): Promise<void> {
    return this.exclusive(() => {
      const trimmed = name.trim();
      if (trimmed === "") throw new HakenError("app", "Empty label name");
      return this.relabelNow(label, (c) => c.map((v) => (v === label ? trimmed : v)));
    });
  }

  /** Removes `label` from every task carrying it; the tasks stay (ADR-20261108-label-edit). */
  deleteLabel(label: string): Promise<void> {
    return this.exclusive(() => this.relabelNow(label, (c) => c.filter((v) => v !== label)));
  }

  /** Rewrites `CATEGORIES` of the readable tasks of the user's lists. */
  private async relabelNow(
    label: string,
    next: (categories: readonly string[]) => string[],
  ): Promise<void> {
    const store = this.requireStore();
    const userLists = new Set(
      (await store.lists())
        .filter((l) => !l.deleted && l.displayName !== ERRORLOGS)
        .map((l) => l.href),
    );
    const now = new Date();
    const putTasks: TaskRecord[] = [];
    const expect: { href: string; ics: string }[] = [];
    const addOps: OutboxInput[] = [];
    for (const record of await store.tasks()) {
      if (record.deleted || record.invalid !== null || !userLists.has(record.list)) continue;
      const view = readTask(parseResource(record.ics));
      if (!view.categories.includes(label)) continue;
      const result = applyEdit(
        record.ics,
        { kind: "categories", value: next(view.categories) },
        now,
      );
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
    const order = await this.labelOrder();
    const nextOrder = relabelOrder(order, next);
    const changedOrder =
      nextOrder.length !== order.length || nextOrder.some((name, i) => name !== order[i]);
    if (putTasks.length === 0 && !changedOrder) return;
    await this.changed({
      putTasks,
      expect,
      addOps,
      putState: changedOrder ? { [LABEL_ORDER]: JSON.stringify(nextOrder) } : {},
    });
  }

  useConflict(id: number): Promise<void> {
    return this.exclusive(() => this.useConflictNow(id));
  }

  private async useConflictNow(id: number): Promise<void> {
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

  dismissConflict(id: number): Promise<void> {
    return this.exclusive(() => this.dismissConflictNow(id));
  }

  private async dismissConflictNow(id: number): Promise<void> {
    await this.conflict(id);
    await this.changed({ deleteConflicts: [id] });
  }

  private async conflict(id: number): Promise<ConflictRecord> {
    const c = (await this.requireStore().conflicts()).find((x) => x.id === id);
    if (c === undefined) throw new HakenError("app", "Unknown conflict note", { id });
    return c;
  }

  attach(href: string, file: File): Promise<AttachResult> {
    return this.exclusive(() => this.attachNow(href, file));
  }

  private async attachNow(href: string, file: File): Promise<AttachResult> {
    if (file.size > ATTACHMENT_LIMIT) return { kind: "too-large" };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(bytes);
    const current = new TextEncoder().encode((await this.taskRecord(href)).ics).length;
    if (current + Math.ceil((base64.length * 78) / 75) + ATTACH_OVERHEAD > RESOURCE_LIMIT)
      return { kind: "task-too-large" };
    await this.editNow(href, {
      kind: "addAttachment",
      filename: file.name === "" ? "attachment" : file.name,
      mediaType: file.type === "" ? "application/octet-stream" : file.type,
      base64,
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

  confirmImport(listHref: string, preview: ImportPreview): Promise<void> {
    return this.exclusive(() => this.confirmImportNow(listHref, preview));
  }

  private async confirmImportNow(listHref: string, preview: ImportPreview): Promise<void> {
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

  writeErrorTask(report: ErrorReport, print: string): Promise<boolean> {
    return this.exclusive(() => this.writeErrorTaskNow(report, print));
  }

  private async writeErrorTaskNow(report: ErrorReport, print: string): Promise<boolean> {
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
      const href = await this.createListNow(ERRORLOGS);
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

function uidOf(items: readonly TaskItem[], href: string): string {
  const view = items.find((i) => i.href === href)?.view;
  if (view == null) throw new HakenError("app", "Unknown task", { path: href });
  return view.uid;
}

function viewsOf(items: readonly TaskItem[]): TaskView[] {
  return items.flatMap((i) => (i.view === null ? [] : [i.view]));
}

type Row = TaskItem & { parentUid: string | null };

function buildLists(
  lists: readonly ListRecord[],
  tasks: readonly TaskRecord[],
  conflicts: readonly ConflictRecord[],
  pending: ReadonlySet<string>,
  tooLarge: ReadonlySet<string>,
): { lists: ListItem[]; orphans: string[] } {
  const orphans: string[] = [];
  const out: ListItem[] = [];
  for (const list of lists) {
    if (list.deleted) continue;
    const items: Row[] = tasks
      .filter((t) => t.list === list.href && !t.deleted)
      .map((t) => row(t, conflicts, pending, tooLarge));
    const { open, done } = nest(items, orphans);
    out.push({
      href: list.href,
      name: list.displayName,
      color: list.color,
      errorlogs: list.displayName === ERRORLOGS,
      tasks: [...open, ...done],
      openCount: open.length,
    });
  }
  out.sort(compareLists(lists));
  return { lists: out, orphans };
}

function row(
  t: TaskRecord,
  conflicts: readonly ConflictRecord[],
  pending: ReadonlySet<string>,
  tooLarge: ReadonlySet<string>,
): Row {
  const view = t.invalid === null ? readTask(parseResource(t.ics)) : null;
  return {
    href: t.href,
    list: t.list,
    view,
    invalid: t.invalid,
    steps: [],
    conflicts: conflicts.filter((c) => c.href === t.href),
    pending: pending.has(t.href),
    tooLarge: tooLarge.has(t.href),
    parentUid: view?.parentUid ?? null,
  };
}

/** Steps under their parent; steps whose parent is missing stay on top and are reported. */
function nest(items: readonly Row[], orphans: string[]): { open: TaskItem[]; done: TaskItem[] } {
  const byUid = new Map(items.filter((i) => i.view !== null).map((i) => [i.view?.uid ?? "", i]));
  const steps = new Map<string, TaskItem[]>();
  const top: Row[] = [];
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
    return { ...stripParent(t), steps: own.toSorted(byOrder) };
  });
  const open = withSteps.filter((t) => !t.view?.done).sort(byOrder);
  const done = withSteps
    .filter((t) => t.view?.done === true)
    .sort((a, b) => (b.view?.completedAt ?? 0) - (a.view?.completedAt ?? 0));
  return { open, done };
}

/** errorlogs last; then lists with an order by it, then the rest by name. */
function compareLists(lists: readonly ListRecord[]): (a: ListItem, b: ListItem) => number {
  const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
  const orderOf = (item: ListItem): number | null =>
    lists.find((l) => l.href === item.href)?.order ?? null;
  return (a, b) => {
    if (a.errorlogs !== b.errorlogs) return a.errorlogs ? 1 : -1;
    const la = orderOf(a);
    const lb = orderOf(b);
    if (la !== null && lb !== null && la !== lb) return la - lb;
    if ((la === null) !== (lb === null)) return la === null ? 1 : -1;
    return collator.compare(a.name, b.name);
  };
}

function stripParent(item: Row): TaskItem {
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

export { UnreachableError } from "../net/http.js";
