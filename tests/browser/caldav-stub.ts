// A minimal CalDAV server for the browser unit tests, answering the page's
// fetch calls through Playwright routing: just the requests haken makes,
// with ETag preconditions, sync tokens and UID conflicts. The app's own
// files come from dist/web; nothing reaches the network.
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import type { Page, Route } from "@playwright/test";

export const ORIGIN = "http://127.0.0.1:8299";
export const HOME = "/dav/u/";
const DIST = join(process.cwd(), "dist", "web");
const HARNESS = join(process.cwd(), "tests", "browser", "harness.mjs");

export interface Reply {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}

interface Member {
  ics: string;
  etag: string;
  uid: string;
  version: number;
}

interface Collection {
  displayName: string;
  color: string | null;
  version: number;
  members: Map<string, Member>;
  /** Removed members with the version of their removal. */
  removed: Map<string, number>;
}

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
};

const xml = (status: number, body: string): Reply => ({
  status,
  headers: { "Content-Type": "application/xml; charset=utf-8" },
  body: `<?xml version="1.0" encoding="utf-8"?>\n${body}`,
});
const multistatus = (responses: string): Reply =>
  xml(
    207,
    `<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/">${responses}</d:multistatus>`,
  );
const escapeXml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const ok = (href: string, props: string): string =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
const parentOf = (href: string): string => href.slice(0, href.lastIndexOf("/") + 1);

export class CalDavStub {
  readonly lists = new Map<string, Collection>();
  /** `METHOD path` of every server request, in order. */
  readonly requests: string[] = [];
  /** Requests the stub does not implement; a test fails if any occur. */
  readonly unhandled: string[] = [];
  /** Answers a request instead of the stub (fault injection); `null`: no override. */
  fault: ((method: string, path: string) => Reply | null) | null = null;
  /** Runs before a PUT is applied (e.g. another client or a local edit racing it). */
  beforePut: ((path: string) => Promise<void>) | null = null;
  /** Rejects every non-empty sync token (RFC 6578 3.2 `valid-sync-token`). */
  invalidTokens = false;
  private etags = 0;

  constructor(lists: readonly string[] = ["l1"]) {
    for (const name of lists) this.addList(name);
  }

  addList(name: string, color: string | null = null): string {
    const href = `${HOME}${name}/`;
    this.lists.set(href, {
      displayName: name,
      color,
      version: 1,
      members: new Map(),
      removed: new Map(),
    });
    return href;
  }

  list(href: string): Collection {
    const list = this.lists.get(href);
    if (list === undefined) throw new Error(`stub: no list ${href}`);
    return list;
  }

  /** Another client writes a resource (unconditionally). */
  write(href: string, ics: string): string {
    const list = this.list(parentOf(href));
    list.version++;
    const etag = `"e${++this.etags}"`;
    const uid = /^UID:(.*)$/m.exec(ics)?.[1]?.trim() ?? "";
    list.members.set(href, { ics, etag, uid, version: list.version });
    list.removed.delete(href);
    return etag;
  }

  /** Another client deletes a resource. */
  remove(href: string): void {
    const list = this.list(parentOf(href));
    list.version++;
    list.members.delete(href);
    list.removed.set(href, list.version);
  }

  ics(href: string): string | null {
    return this.lists.get(parentOf(href))?.members.get(href)?.ics ?? null;
  }

  token(href: string): string {
    return `http://stub/sync/${this.list(href).version}`;
  }

  count(request: string): number {
    return this.requests.filter((r) => r === request).length;
  }

  /** Routes the origin to dist/web and this stub, then opens a blank page with the harness. */
  async attach(page: Page): Promise<void> {
    await page.route(`${ORIGIN}/**`, (route) => this.route(route));
    await page.goto(`${ORIGIN}/`);
    await page.evaluate(async () => {
      Object.assign(window, { h: await import("/harness.mjs") });
    });
  }

  private async route(route: Route): Promise<void> {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path === "/") {
      await route.fulfill({ contentType: "text/html", body: "<!doctype html><title>test</title>" });
      return;
    }
    if (!path.startsWith("/dav/") && !path.startsWith("/api/")) {
      const file = path === "/harness.mjs" ? HARNESS : join(DIST, normalize(path));
      await route.fulfill({
        contentType: TYPES[extname(file)] ?? "application/octet-stream",
        body: readFileSync(file),
      });
      return;
    }
    const method = req.method();
    this.requests.push(`${method} ${path}`);
    const headers = req.headers();
    const reply =
      this.fault?.(method, path) ??
      (method === "PUT" ? await this.put(path, req.postData() ?? "", headers) : null) ??
      this.answer(method, path, req.postData() ?? "");
    await route.fulfill({
      status: reply.status,
      headers: reply.headers ?? {},
      body: reply.body ?? "",
    });
  }

  private answer(method: string, path: string, body: string): Reply {
    if (path === "/api/session" && method === "GET")
      return {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: '{"user":"u"}',
      };
    if (path === HOME && method === "PROPFIND") return this.collections();
    const list = this.lists.get(path);
    if (list !== undefined) {
      if (method === "PROPFIND") return this.etagsOf(path, list);
      if (method === "REPORT" && body.includes("sync-collection"))
        return this.syncCollection(path, list, body);
      if (method === "REPORT" && body.includes("calendar-multiget")) return this.multiget(body);
    }
    const parent = this.lists.get(parentOf(path));
    if (parent !== undefined && !path.endsWith("/")) {
      const member = parent.members.get(path);
      if (method === "GET")
        return member === undefined
          ? { status: 404 }
          : { status: 200, headers: { ETag: member.etag }, body: member.ics };
    }
    this.unhandled.push(`${method} ${path}`);
    return { status: 501 };
  }

  private collections(): Reply {
    let out = ok(HOME, "<d:resourcetype><d:collection/></d:resourcetype>");
    for (const [href, list] of this.lists) {
      out += ok(
        href,
        `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>${escapeXml(list.displayName)}</d:displayname>${list.color === null ? "" : `<a:calendar-color>${escapeXml(list.color)}</a:calendar-color>`}<d:sync-token>${this.token(href)}</d:sync-token>`,
      );
    }
    return multistatus(out);
  }

  private etagsOf(href: string, list: Collection): Reply {
    let out = ok(href, "");
    for (const [m, member] of list.members) out += ok(m, `<d:getetag>${member.etag}</d:getetag>`);
    return multistatus(out);
  }

  private syncCollection(href: string, list: Collection, body: string): Reply {
    const token = /<d:sync-token>([^<]*)</.exec(body)?.[1] ?? "";
    const since = token === "" ? 0 : Number(token.slice("http://stub/sync/".length));
    if (token !== "" && (this.invalidTokens || !(since <= list.version)))
      return xml(403, '<d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>');
    let out = "";
    for (const [m, member] of list.members)
      if (member.version > since) out += ok(m, `<d:getetag>${member.etag}</d:getetag>`);
    if (since > 0)
      for (const [m, version] of list.removed)
        if (version > since)
          out += `<d:response><d:href>${m}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
    const reply = multistatus(`${out}<d:sync-token>${this.token(href)}</d:sync-token>`);
    return reply;
  }

  private multiget(body: string): Reply {
    let out = "";
    for (const [, href] of body.matchAll(/<d:href>([^<]+)<\/d:href>/g)) {
      const member =
        href === undefined ? undefined : this.lists.get(parentOf(href))?.members.get(href);
      out +=
        member === undefined
          ? `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`
          : ok(
              href as string,
              `<d:getetag>${member.etag}</d:getetag><c:calendar-data>${escapeXml(member.ics)}</c:calendar-data>`,
            );
    }
    return multistatus(out);
  }

  private async put(path: string, ics: string, headers: Record<string, string>): Promise<Reply> {
    const list = this.lists.get(parentOf(path));
    if (list === undefined) return { status: 409 };
    await this.beforePut?.(path);
    const existing = list.members.get(path);
    const ifMatch = headers["if-match"];
    if (headers["if-none-match"] === "*" && existing !== undefined) return { status: 412 };
    if (ifMatch !== undefined && existing?.etag !== ifMatch) return { status: 412 };
    const uid = /^UID:(.*)$/m.exec(ics)?.[1]?.trim() ?? "";
    for (const [href, member] of list.members) {
      if (href !== path && member.uid === uid)
        return xml(
          409,
          `<d:error xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><c:no-uid-conflict><d:href>${href}</d:href></c:no-uid-conflict></d:error>`,
        );
    }
    const etag = this.write(path, ics);
    return { status: existing === undefined ? 201 : 204, headers: { ETag: etag } };
  }
}
