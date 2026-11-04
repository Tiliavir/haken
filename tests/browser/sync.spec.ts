// Browser unit tests: the built store and sync modules in a real browser
// (IndexedDB, Web Locks, DOMParser), against the CalDAV stub.
import { expect, type Page, test } from "@playwright/test";
import { CalDavStub, HOME } from "./caldav-stub.js";

/** Page-side helpers from harness.mjs (types for this file only). */
interface TaskRecord {
  href: string;
  uid: string;
  ics: string;
  etag: string | null;
}
interface H {
  LIST: string;
  SCHEMA: 1;
  store: {
    task(href: string): Promise<TaskRecord | null>;
    tasks(): Promise<TaskRecord[]>;
    lists(): Promise<{ href: string; syncToken: string | null }[]>;
    outbox(): Promise<{ id: number; href: string; groups: string[] }[]>;
    base(href: string): Promise<{ etag: string } | null>;
    commit(changes: object): Promise<void>;
  };
  StaleError: new (...args: never[]) => Error;
  transact(
    db: unknown,
    stores: string[],
    mode: string,
    fn: (tx: unknown) => Promise<void>,
  ): Promise<void>;
  events: { invalid: string[]; quarantined: { href: string; message: string }[] };
  sync(): Promise<string>;
  newIcs(uid: string, summary: string): string;
  addTask(uid: string, summary: string, list?: string): Promise<string>;
  editTask(href: string, edit: object): Promise<void>;
  editAfterNextRead(href: string, edit: object): void;
  view(ics: string): { summary: string; important: boolean; uid: string };
  quarantined(): Promise<string[]>;
}
declare global {
  interface Window {
    h: H;
  }
}

const LIST = `${HOME}l1/`;
let stub: CalDavStub;

test.beforeEach(async ({ page }) => {
  stub = new CalDavStub();
  page.on("pageerror", (e) => {
    throw e;
  });
  await stub.attach(page);
});

test.afterEach(() => {
  expect(stub.unhandled).toEqual([]);
});

const sync = (page: Page): Promise<string> => page.evaluate(() => window.h.sync());
const local = (page: Page, href: string): Promise<TaskRecord | null> =>
  page.evaluate((href) => window.h.store.task(href), href);
const summaryOf = (ics: string | null): string | undefined =>
  /^SUMMARY:(.*)$/m.exec(ics ?? "")?.[1]?.trim();

/** A task that exists on the server and locally, without pending changes. */
async function synced(page: Page, uid: string, summary: string): Promise<string> {
  const href = await page.evaluate(([u, s]) => window.h.addTask(u, s), [uid, summary] as const);
  expect(await sync(page)).toBe("synced");
  expect(stub.ics(href)).not.toBeNull();
  return href;
}

test.describe("commit", () => {
  test("fails with StaleError when a task or outbox entry changed, and writes nothing", async ({
    page,
  }) => {
    const result = await page.evaluate(async () => {
      const { store, addTask, StaleError, SCHEMA } = window.h;
      const href = await addTask("t1", "One");
      const before = await store.task(href);
      const [op] = await store.outbox();
      const marker = {
        schema: SCHEMA,
        href: "/dav/u/l1/x.ics",
        list: "/dav/u/l1/",
        uid: "x",
        ics: "x",
        etag: null,
        deleted: false,
        invalid: null,
      };
      const stale = async (changes: object): Promise<string> => {
        try {
          await store.commit({ putTasks: [marker], ...changes });
          return "committed";
        } catch (e) {
          return e instanceof StaleError ? "stale" : String(e);
        }
      };
      return {
        wrongIcs: await stale({ expect: [{ href, ics: "other" }] }),
        mustNotExist: await stale({ expect: [{ href, ics: null }] }),
        missingOp: await stale({ expectOps: [(op?.id ?? 0) + 1000] }),
        matching: await stale({
          expect: [{ href, ics: before?.ics ?? "" }],
          expectOps: [op?.id ?? 0],
        }),
        tasks: (await store.tasks()).map((t) => t.href).sort(),
      };
    });
    expect(result).toEqual({
      wrongIcs: "stale",
      mustNotExist: "stale",
      missingOp: "stale",
      matching: "committed",
      tasks: ["/dav/u/l1/t1.ics", "/dav/u/l1/x.ics"],
    });
  });

  test("an exception inside a transaction aborts all of it", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const { store, transact, SCHEMA, addTask } = window.h;
      const href = await addTask("t1", "One");
      const db = (store as unknown as { db: IDBDatabase }).db;
      const error = await transact(db, ["tasks", "outbox"], "readwrite", async (tx) => {
        const t = tx as IDBTransaction;
        t.objectStore("outbox").clear();
        t.objectStore("tasks").put({
          schema: SCHEMA,
          href: "/dav/u/l1/y.ics",
          list: "/dav/u/l1/",
          uid: "y",
          ics: "y",
          etag: null,
          deleted: false,
          invalid: null,
        });
        throw new Error("boom");
      }).then(
        () => "no error",
        (e: Error) => e.message,
      );
      return {
        error,
        tasks: (await store.tasks()).map((t) => t.href),
        outbox: (await store.outbox()).length,
        kept: (await store.task(href)) !== null,
      };
    });
    expect(result).toEqual({ error: "boom", tasks: ["/dav/u/l1/t1.ics"], outbox: 1, kept: true });
  });
});

test.describe("push", () => {
  test("412: fetch, merge, push again with the new ETag", async ({ page }) => {
    const href = await synced(page, "t1", "One");
    // Another client changes the title; haken marks the task important meanwhile.
    stub.write(href, (stub.ics(href) ?? "").replace("SUMMARY:One", "SUMMARY:Server"));
    await page.evaluate(
      (href) => window.h.editTask(href, { kind: "important", value: true }),
      href,
    );
    stub.requests.length = 0;
    expect(await sync(page)).toBe("synced");
    expect(stub.count(`PUT ${href}`)).toBe(1);
    const server = stub.ics(href) ?? "";
    expect(summaryOf(server)).toBe("Server");
    expect(server).toMatch(/^PRIORITY:1\r?$/m);
    const after = await local(page, href);
    expect(after?.ics).toBe(server);
    expect(await page.evaluate(() => window.h.store.outbox())).toEqual([]);
  });

  test("a 412 that keeps coming back stops after 3 attempts and quarantines only that task", async ({
    page,
  }) => {
    const busy = await synced(page, "t1", "One");
    await page.evaluate(async (href) => {
      await window.h.editTask(href, { kind: "important", value: true });
      await window.h.addTask("t2", "Two");
    }, busy);
    let n = 0;
    stub.beforePut = async (path) => {
      if (path === busy)
        stub.write(busy, (stub.ics(busy) ?? "").replace(/SUMMARY:.*/, `SUMMARY:Race ${++n}`));
    };
    expect(await sync(page)).toBe("synced");
    expect(n).toBe(3);
    expect(stub.ics(`${LIST}t2.ics`)).not.toBeNull();
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([busy]);
    const events = await page.evaluate(() => window.h.events.quarantined);
    expect(events).toEqual([{ href: busy, message: "Push did not settle after merging" }]);
    // The local edit is still pending.
    const ops = await page.evaluate(() => window.h.store.outbox());
    expect(ops.map((o) => o.href)).toEqual([busy]);
  });

  test("an edit during a successful PUT keeps the server's ETag and the newer edit", async ({
    page,
  }) => {
    const href = await synced(page, "t1", "One");
    await page.evaluate((href) => window.h.editTask(href, { kind: "summary", value: "Two" }), href);
    // The edit lands between sync's read after the PUT and its commit.
    stub.beforePut = async () => {
      stub.beforePut = null;
      await page.evaluate(
        (href) => window.h.editAfterNextRead(href, { kind: "summary", value: "Three" }),
        href,
      );
    };
    expect(await sync(page)).toBe("synced");
    expect(summaryOf(stub.ics(href))).toBe("Two");
    const after = await local(page, href);
    const serverEtag = stub.list(LIST).members.get(href)?.etag;
    expect(summaryOf(after?.ics ?? null)).toBe("Three");
    expect(after?.etag).toBe(serverEtag);
    expect((await page.evaluate((h) => window.h.store.base(h), href))?.etag).toBe(serverEtag);
    const ops = await page.evaluate(() => window.h.store.outbox());
    expect(ops).toHaveLength(1);
    expect(ops[0]?.groups).toContain("SUMMARY");
    // The next run pushes the newer edit without a conflict.
    stub.requests.length = 0;
    expect(await sync(page)).toBe("synced");
    expect(summaryOf(stub.ics(href))).toBe("Three");
    expect(stub.requests.filter((r) => r.startsWith("GET /dav"))).toEqual([]);
  });

  test("a UID used by another resource quarantines the task", async ({ page }) => {
    stub.write(
      `${LIST}other.ics`,
      await page.evaluate(() => window.h.newIcs("dup", "Other client")),
    );
    const href = await page.evaluate(() => window.h.addTask("dup", "Mine"));
    // Pull first stores other.ics; the push of dup.ics then conflicts on the UID.
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([href]);
    expect(await page.evaluate(() => window.h.events.quarantined.map((q) => q.message))).toEqual([
      "UID used by another resource in the list",
    ]);
    expect(stub.ics(href)).toBeNull();
  });
});

test.describe("quarantine", () => {
  test("a failing PUT skips the task until it changes; the rest syncs", async ({ page }) => {
    const [bad, good] = await page.evaluate(async () => [
      await window.h.addTask("bad", "Bad"),
      await window.h.addTask("good", "Good"),
    ]);
    stub.fault = (method, path) => (method === "PUT" && path === bad ? { status: 500 } : null);
    expect(await sync(page)).toBe("synced");
    expect(stub.ics(good)).not.toBeNull();
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([bad]);
    expect(await page.evaluate(() => window.h.events.quarantined.length)).toBe(1);

    // Unchanged: not tried again, no new error.
    stub.requests.length = 0;
    expect(await sync(page)).toBe("synced");
    expect(stub.count(`PUT ${bad}`)).toBe(0);
    expect(await page.evaluate(() => window.h.events.quarantined.length)).toBe(1);

    // A local change: tried again; success releases it.
    stub.fault = null;
    await page.evaluate(
      (href) => window.h.editTask(href, { kind: "summary", value: "Fixed" }),
      bad,
    );
    expect(await sync(page)).toBe("synced");
    expect(summaryOf(stub.ics(bad))).toBe("Fixed");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([]);
  });

  test("a failing pull of one task waits for a new server version", async ({ page }) => {
    const href = await synced(page, "t1", "One");
    // Another client puts a different UID at the same path: the merge with the pending edit fails.
    await page.evaluate(
      (href) => window.h.editTask(href, { kind: "important", value: true }),
      href,
    );
    stub.write(href, await page.evaluate(() => window.h.newIcs("t1-other", "Other")));
    stub.beforePut = async () => {
      throw new Error("no PUT expected");
    };
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([href]);
    expect(await page.evaluate(() => window.h.events.quarantined.map((q) => q.message))).toEqual([
      "Merge of different UIDs",
    ]);
    // Same server version: skipped.
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.events.quarantined.length)).toBe(1);
    // The other client fixes it: retried, merged, pushed, released.
    stub.beforePut = null;
    stub.write(href, (stub.ics(href) ?? "").replace("UID:t1-other", "UID:t1"));
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([]);
    expect(stub.ics(href)).toMatch(/^PRIORITY:1\r?$/m);
  });

  test("a list with invalid properties is skipped; other lists sync", async ({ page }) => {
    const bad = stub.addList("l2", "red");
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([`pull:${bad}`]);
    const lists = await page.evaluate(() => window.h.store.lists());
    expect(lists.map((l) => l.href)).toEqual([LIST]);
    // Fixed on the server: added on the next run, record released.
    stub.list(bad).color = "#112233";
    expect(await sync(page)).toBe("synced");
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([]);
    expect((await page.evaluate(() => window.h.store.lists())).map((l) => l.href).sort()).toEqual([
      LIST,
      bad,
    ]);
  });

  test("an unexpected answer to list discovery stops the run", async ({ page }) => {
    stub.fault = (method, path) =>
      method === "PROPFIND" && path === HOME ? { status: 500 } : null;
    await expect(sync(page)).rejects.toThrow(/Unexpected CalDAV response/);
    expect(await page.evaluate(() => window.h.quarantined())).toEqual([]);
  });
});

test.describe("pull", () => {
  test("an invalid sync token falls back to comparing ETags", async ({ page }) => {
    const keep = await synced(page, "t1", "One");
    const gone = await synced(page, "t2", "Two");
    stub.invalidTokens = true;
    stub.write(keep, (stub.ics(keep) ?? "").replace("SUMMARY:One", "SUMMARY:Changed"));
    stub.remove(gone);
    stub.requests.length = 0;
    expect(await sync(page)).toBe("synced");
    expect(stub.count(`PROPFIND ${LIST}`)).toBe(1);
    expect(summaryOf((await local(page, keep))?.ics ?? null)).toBe("Changed");
    expect(await local(page, gone)).toBeNull();
    const [list] = await page.evaluate(() => window.h.store.lists());
    expect(list?.syncToken).toBe(stub.token(LIST));
  });

  test("an edit during a pull is merged, not overwritten", async ({ page }) => {
    const href = await synced(page, "t1", "One");
    stub.write(href, (stub.ics(href) ?? "").replace("SUMMARY:One", "SUMMARY:Server"));
    await page.evaluate(
      (href) => window.h.editAfterNextRead(href, { kind: "important", value: true }),
      href,
    );
    expect(await sync(page)).toBe("synced");
    const server = stub.ics(href) ?? "";
    expect(summaryOf(server)).toBe("Server");
    expect(server).toMatch(/^PRIORITY:1\r?$/m);
    expect((await local(page, href))?.ics).toBe(server);
  });
});
