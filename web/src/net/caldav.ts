/**
 * CalDAV client (RFC 4791, RFC 6578). Every response is checked against the
 * documented status codes and shapes; anything else throws `HakenError`
 * (ADR-20261104-strict-errors). Expected outcomes (412, 404, 413, invalid
 * sync token) are returned as values.
 */
import { HakenError, InvalidInputError } from "../domain/errors.js";
import { errorId } from "./api.js";
import { type ServerResponse, server } from "./http.js";
import { parseXml } from "./trusted.js";

const DAV = "DAV:";
const CALDAV = "urn:ietf:params:xml:ns:caldav";
const APPLE = "http://apple.com/ns/ical/";

const XML_HEADERS = { "Content-Type": "application/xml; charset=utf-8", Accept: "application/xml" };

export interface RemoteList {
  readonly href: string;
  readonly displayName: string;
  readonly color: string | null;
  readonly order: number | null;
  /** Current `DAV:sync-token` (RFC 6578 4); `null` if the server does not offer it. */
  readonly syncToken: string | null;
}

export interface RemoteResource {
  readonly href: string;
  readonly etag: string;
  readonly ics: string;
}

function unexpected(
  method: string,
  path: string,
  response: ServerResponse,
  reason = "status",
): HakenError {
  return new HakenError("net", `Unexpected CalDAV response (${reason})`, {
    method,
    path,
    status: response.status,
    ...errorId(response.text),
  });
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.codePointAt(0)};`);
}

function parseMultistatus(method: string, path: string, response: ServerResponse): Element[] {
  if (response.status !== 207) throw unexpected(method, path, response);
  const type = response.headers.get("Content-Type") ?? "";
  if (!/^(application|text)\/xml\b/.test(type))
    throw unexpected(method, path, response, "content type");
  const doc = parseXml(response.text);
  if (doc.getElementsByTagName("parsererror").length > 0)
    throw unexpected(method, path, response, "malformed XML");
  const root = doc.documentElement;
  if (root.namespaceURI !== DAV || root.localName !== "multistatus") {
    throw unexpected(method, path, response, "no multistatus");
  }
  return children(root, DAV, "response");
}

function children(el: Element, ns: string, name: string): Element[] {
  return [...el.children].filter((c) => c.namespaceURI === ns && c.localName === name);
}

function child(el: Element, ns: string, name: string): Element | null {
  return children(el, ns, name)[0] ?? null;
}

function hrefOf(response: Element, method: string, path: string): string {
  const href = child(response, DAV, "href")?.textContent?.trim() ?? "";
  if (!href.startsWith("/dav/")) {
    throw new InvalidInputError("net", "Response href outside /dav", { method, path });
  }
  // Normalise percent-encoding so the same resource always has the same key.
  return encodeURI(decodeURI(href));
}

function statusCode(el: Element | null): number | null {
  const text = el === null ? null : child(el, DAV, "status")?.textContent;
  if (text === null || text === undefined) return null;
  const m = /^HTTP\/\d(?:\.\d)? (\d{3})/.exec(text.trim());
  return m === null ? null : Number(m[1]);
}

/** The `prop` element of the 200 propstat, or `null` if there is none. */
function okProps(response: Element): Element | null {
  for (const ps of children(response, DAV, "propstat")) {
    if (statusCode(ps) === 200) return child(ps, DAV, "prop");
  }
  return null;
}

export interface Collections {
  readonly lists: readonly RemoteList[];
  /** Task collections whose properties failed validation; each is skipped on its own. */
  readonly invalid: readonly InvalidList[];
}

export interface InvalidList {
  readonly href: string;
  readonly error: InvalidInputError;
  /** The raw values of the validated properties; changes when they change on the server. */
  readonly signature: string;
}

/** Task collections in the calendar home (`/dav/<user>/`). */
export async function listCollections(home: string): Promise<Collections> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:c="${CALDAV}" xmlns:a="${APPLE}">
  <d:prop><d:resourcetype/><d:displayname/><c:supported-calendar-component-set/><a:calendar-color/><a:calendar-order/><d:sync-token/></d:prop>
</d:propfind>`;
  const response = await server("PROPFIND", home, {
    headers: { ...XML_HEADERS, Depth: "1" },
    body,
  });
  const lists: RemoteList[] = [];
  const invalid: InvalidList[] = [];
  for (const r of parseMultistatus("PROPFIND", home, response)) {
    const href = hrefOf(r, "PROPFIND", home);
    if (href === encodeURI(decodeURI(home))) continue;
    const prop = okProps(r);
    if (prop === null) continue;
    const resourcetype = child(prop, DAV, "resourcetype");
    if (resourcetype === null || child(resourcetype, CALDAV, "calendar") === null) continue;
    const components = child(prop, CALDAV, "supported-calendar-component-set");
    const names =
      components === null
        ? null
        : children(components, CALDAV, "comp").map((c) => c.getAttribute("name"));
    // Without the property the collection accepts every component type (RFC 4791 5.2.3).
    if (names !== null && !names.includes("VTODO")) continue;
    const list = href.endsWith("/") ? href : `${href}/`;
    try {
      lists.push(collection(list, prop));
    } catch (error) {
      if (!(error instanceof InvalidInputError)) throw error;
      const raw = (ns: string, name: string): string | null =>
        child(prop, ns, name)?.textContent ?? null;
      const signature = JSON.stringify([
        raw(APPLE, "calendar-color"),
        raw(APPLE, "calendar-order"),
      ]);
      invalid.push({ href: list, error, signature });
    }
  }
  return { lists, invalid };
}

function collection(href: string, prop: Element): RemoteList {
  const displayName = child(prop, DAV, "displayname")?.textContent ?? "";
  const color = child(prop, APPLE, "calendar-color")?.textContent?.trim() || null;
  const orderText = child(prop, APPLE, "calendar-order")?.textContent?.trim() ?? "";
  const order = orderText === "" ? null : Number(orderText);
  if (order !== null && !Number.isFinite(order)) {
    throw new InvalidInputError("net", "calendar-order is not a number", {
      method: "PROPFIND",
      path: href,
      value: orderText,
    });
  }
  if (color !== null && !/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(color)) {
    throw new InvalidInputError("net", "calendar-color is not a hex colour", {
      method: "PROPFIND",
      path: href,
      value: color,
    });
  }
  const syncToken = child(prop, DAV, "sync-token")?.textContent?.trim() || null;
  return { href, displayName, color, order, syncToken };
}

export async function makeCalendar(
  href: string,
  displayName: string,
  order: number | null,
): Promise<"created" | "exists"> {
  if (order !== null && !Number.isInteger(order))
    throw new HakenError("net", "calendar-order must be an integer", { path: href });
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:mkcalendar xmlns:d="DAV:" xmlns:c="${CALDAV}" xmlns:a="${APPLE}">
  <d:set><d:prop>
    <d:displayname>${escapeXml(displayName)}</d:displayname>${
      order === null
        ? ""
        : `
    <a:calendar-order>${order}</a:calendar-order>`
    }
    <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>
  </d:prop></d:set>
</c:mkcalendar>`;
  const response = await server("MKCALENDAR", href, { headers: XML_HEADERS, body });
  if (response.status === 201) return "created";
  // 405: the collection already exists (a previous attempt succeeded but the response was lost).
  if (response.status === 405) return "exists";
  throw unexpected("MKCALENDAR", href, response);
}

export async function patchList(
  href: string,
  fields: {
    readonly displayName?: string;
    readonly color?: string | null;
    readonly order?: number | null;
  },
): Promise<void> {
  const set: string[] = [];
  const del: string[] = [];
  if (fields.displayName !== undefined)
    set.push(`<d:displayname>${escapeXml(fields.displayName)}</d:displayname>`);
  if (fields.color !== undefined) {
    if (fields.color === null) del.push("<a:calendar-color/>");
    else set.push(`<a:calendar-color>${escapeXml(fields.color)}</a:calendar-color>`);
  }
  if (fields.order !== undefined) {
    if (fields.order === null) del.push("<a:calendar-order/>");
    else set.push(`<a:calendar-order>${fields.order}</a:calendar-order>`);
  }
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:propertyupdate xmlns:d="DAV:" xmlns:a="${APPLE}">
  ${set.length > 0 ? `<d:set><d:prop>${set.join("")}</d:prop></d:set>` : ""}
  ${del.length > 0 ? `<d:remove><d:prop>${del.join("")}</d:prop></d:remove>` : ""}
</d:propertyupdate>`;
  const response = await server("PROPPATCH", href, { headers: XML_HEADERS, body });
  for (const r of parseMultistatus("PROPPATCH", href, response)) {
    for (const ps of children(r, DAV, "propstat")) {
      if (statusCode(ps) !== 200) throw unexpected("PROPPATCH", href, response, "property not set");
    }
  }
}

/** Number of member resources (Depth 1), used before deleting a list. */
export async function memberCount(href: string): Promise<number> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`;
  const response = await server("PROPFIND", href, {
    headers: { ...XML_HEADERS, Depth: "1" },
    body,
  });
  const self = encodeURI(decodeURI(href));
  return parseMultistatus("PROPFIND", href, response).filter(
    (r) => hrefOf(r, "PROPFIND", href) !== self,
  ).length;
}

export async function deleteCollection(href: string): Promise<"deleted" | "gone"> {
  const response = await server("DELETE", href);
  if (response.status === 200 || response.status === 204) return "deleted";
  if (response.status === 404) return "gone";
  throw unexpected("DELETE", href, response);
}

export type SyncResult =
  | {
      readonly kind: "ok";
      readonly token: string;
      readonly changed: readonly { readonly href: string; readonly etag: string }[];
      readonly removed: readonly string[];
    }
  | { readonly kind: "invalid-token" };

/** `sync-collection` REPORT (RFC 6578). `token` `null` means initial sync. */
export async function syncCollection(href: string, token: string | null): Promise<SyncResult> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<d:sync-collection xmlns:d="DAV:">
  <d:sync-token>${token === null ? "" : escapeXml(token)}</d:sync-token>
  <d:sync-level>1</d:sync-level>
  <d:prop><d:getetag/></d:prop>
</d:sync-collection>`;
  const response = await server("REPORT", href, { headers: XML_HEADERS, body });
  if (
    (response.status === 403 || response.status === 409) &&
    /valid-sync-token/.test(response.text)
  ) {
    return { kind: "invalid-token" };
  }
  const responses = parseMultistatus("REPORT", href, response);
  const doc = parseXml(response.text);
  const newToken = child(doc.documentElement, DAV, "sync-token")?.textContent?.trim() ?? "";
  if (newToken === "") throw unexpected("REPORT", href, response, "no sync-token");
  const changed: { href: string; etag: string }[] = [];
  const removed: string[] = [];
  const self = encodeURI(decodeURI(href));
  for (const r of responses) {
    const h = hrefOf(r, "REPORT", href);
    if (h === self) continue;
    if (statusCode(r) === 404) {
      removed.push(h);
      continue;
    }
    const prop = okProps(r);
    const etag = prop === null ? null : child(prop, DAV, "getetag")?.textContent?.trim();
    if (etag === null || etag === undefined || etag === "") {
      throw unexpected("REPORT", href, response, "member without ETag");
    }
    changed.push({ href: h, etag });
  }
  return { kind: "ok", token: newToken, changed, removed };
}

/** All members with their ETags (fallback when the sync token is invalid). */
export async function listEtags(href: string): Promise<{ href: string; etag: string }[]> {
  const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>`;
  const response = await server("PROPFIND", href, {
    headers: { ...XML_HEADERS, Depth: "1" },
    body,
  });
  const self = encodeURI(decodeURI(href));
  const out: { href: string; etag: string }[] = [];
  for (const r of parseMultistatus("PROPFIND", href, response)) {
    const h = hrefOf(r, "PROPFIND", href);
    if (h === self) continue;
    const prop = okProps(r);
    const etag = prop === null ? null : child(prop, DAV, "getetag")?.textContent?.trim();
    if (etag === null || etag === undefined || etag === "")
      throw unexpected("PROPFIND", href, response, "member without ETag");
    out.push({ href: h, etag });
  }
  return out;
}

/** `calendar-multiget` REPORT. Missing resources (404) are left out of the result. */
export async function multiget(
  collection: string,
  hrefs: readonly string[],
): Promise<RemoteResource[]> {
  if (hrefs.length === 0) return [];
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="${CALDAV}">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  ${hrefs.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join("")}
</c:calendar-multiget>`;
  const response = await server("REPORT", collection, {
    headers: { ...XML_HEADERS, Depth: "1" },
    body,
  });
  const out: RemoteResource[] = [];
  for (const r of parseMultistatus("REPORT", collection, response)) {
    const href = hrefOf(r, "REPORT", collection);
    if (statusCode(r) === 404) continue;
    const prop = okProps(r);
    if (prop === null) {
      if (children(r, DAV, "propstat").some((ps) => statusCode(ps) === 404)) continue;
      throw unexpected("REPORT", collection, response, "member without props");
    }
    const etag = child(prop, DAV, "getetag")?.textContent?.trim() ?? "";
    const ics = child(prop, CALDAV, "calendar-data")?.textContent ?? "";
    if (etag === "" || ics === "")
      throw unexpected("REPORT", collection, response, "member without data");
    out.push({ href, etag, ics: ics.replace(/\r?\n/g, "\r\n") });
  }
  return out;
}

export async function get(href: string): Promise<RemoteResource | null> {
  const response = await server("GET", href, { headers: { Accept: "text/calendar" } });
  if (response.status === 404) return null;
  if (response.status !== 200) throw unexpected("GET", href, response);
  const etag = response.headers.get("ETag");
  if (etag === null || etag === "") throw unexpected("GET", href, response, "no ETag");
  return { href, etag, ics: response.text };
}

export type PutResult =
  | { readonly kind: "ok"; readonly etag: string | null }
  | { readonly kind: "precondition" }
  | { readonly kind: "too-large" }
  | { readonly kind: "not-found" }
  | { readonly kind: "uid-conflict" };

/** Conditional PUT: `etag` `null` creates (`If-None-Match: *`), otherwise `If-Match`. Never unconditional. */
export async function put(href: string, ics: string, etag: string | null): Promise<PutResult> {
  const condition: Record<string, string> =
    etag === null ? { "If-None-Match": "*" } : { "If-Match": etag };
  const response = await server("PUT", href, {
    headers: { "Content-Type": "text/calendar; charset=utf-8", ...condition },
    body: ics,
  });
  switch (response.status) {
    case 200:
    case 201:
    case 204:
      return { kind: "ok", etag: response.headers.get("ETag") };
    case 412:
      return { kind: "precondition" };
    case 413:
      return { kind: "too-large" };
    case 409:
      // Another resource in the collection has the same UID (RFC 4791 5.3.2.1).
      if (/no-uid-conflict/.test(response.text)) return { kind: "uid-conflict" };
      // Otherwise the collection is gone (RFC 4918 9.7.1).
      return { kind: "not-found" };
    case 404:
      // The collection is gone (deleted by another client).
      return { kind: "not-found" };
    default:
      throw unexpected("PUT", href, response);
  }
}

export type DeleteResult = "deleted" | "precondition" | "gone";

export async function del(href: string, etag: string): Promise<DeleteResult> {
  const response = await server("DELETE", href, { headers: { "If-Match": etag } });
  if (response.status === 200 || response.status === 204) return "deleted";
  if (response.status === 412) return "precondition";
  if (response.status === 404) return "gone";
  throw unexpected("DELETE", href, response);
}
