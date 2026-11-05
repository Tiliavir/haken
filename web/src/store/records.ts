/**
 * Shapes of everything stored in IndexedDB, with strict validators that run
 * on every read (ADR-20261104-strict-errors). Each record carries `schema`;
 * a future migration bumps it and must keep a backup of the old shape.
 */
import { byCodeUnit } from "../domain/compare.js";
import { InvalidInputError } from "../domain/errors.js";

export const SCHEMA = 1 as const;

export type SetupStep =
  | "welcome"
  | "intro"
  | "install-first"
  | "mode"
  | "signin"
  | "local"
  | "install"
  | "persist";

export const SETUP_STEPS: readonly SetupStep[] = [
  "welcome",
  "intro",
  "install-first",
  "mode",
  "signin",
  "local",
  "install",
  "persist",
];

export interface AccountRecord {
  readonly schema: typeof SCHEMA;
  readonly id: string;
  readonly type: "server" | "local";
  /** Server accounts only. */
  readonly user: string | null;
  /** Origin the app was loaded from (server accounts only). */
  readonly origin: string | null;
  readonly createdAt: number;
  /** Setup completed (all steps after the account was created). */
  readonly ready: boolean;
}

export interface ListRecord {
  readonly schema: typeof SCHEMA;
  /** Collection path, ends with `/`. */
  readonly href: string;
  readonly displayName: string;
  readonly color: string | null;
  readonly order: number | null;
  readonly syncToken: string | null;
  /** `new`: not yet created on the server (pending MKCALENDAR). */
  readonly state: "synced" | "new";
  /** Soft delete until the server confirms. */
  readonly deleted: boolean;
}

export interface TaskRecord {
  readonly schema: typeof SCHEMA;
  /** Resource path. */
  readonly href: string;
  /** Collection path of the list. */
  readonly list: string;
  readonly uid: string;
  /** Current local text of the resource. */
  readonly ics: string;
  /** ETag of the last server version; `null` = never on the server. */
  readonly etag: string | null;
  /** Soft delete until the server confirms. */
  readonly deleted: boolean;
  /** Set when the resource could not be read; the raw text is kept, never written back. */
  readonly invalid: string | null;
}

/** Last server version, the merge base. */
export interface BaseRecord {
  readonly schema: typeof SCHEMA;
  readonly href: string;
  readonly ics: string;
  readonly etag: string;
}

export type OutboxKind = "put" | "delete" | "mkcalendar" | "proppatch" | "deletelist";

export interface OutboxInput {
  readonly kind: OutboxKind;
  readonly href: string;
  /** Changed property groups (`put`) or list fields (`proppatch`). */
  readonly groups: readonly string[];
  /** Edit time, ms UTC. */
  readonly editedAt: number;
}

export interface OutboxRecord extends OutboxInput {
  readonly schema: typeof SCHEMA;
  readonly id: number;
}

export interface ConflictInput {
  readonly href: string;
  readonly uid: string;
  readonly group: string;
  readonly lines: string;
  readonly lost: "local" | "server";
  readonly at: number;
}

export interface ConflictRecord extends ConflictInput {
  readonly schema: typeof SCHEMA;
  readonly id: number;
}

// ---------------------------------------------------------------- validators

type Obj = Record<string, unknown>;

function fail(store: string, reason: string): never {
  throw new InvalidInputError("store", "Stored record has an unexpected shape", { store, reason });
}

function object(value: unknown, store: string, keys: readonly string[]): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(store, "not an object");
  const record = value as Obj;
  const actual = Object.keys(record).sort(byCodeUnit);
  const expected = [...keys].sort(byCodeUnit);
  if (actual.length !== expected.length || actual.some((k, i) => k !== expected[i])) {
    fail(store, `keys ${actual.join(",")}`);
  }
  if (record["schema"] !== SCHEMA) fail(store, `schema ${String(record["schema"])}`);
  return record;
}

const str = (o: Obj, k: string, store: string): string => {
  const v = o[k];
  if (typeof v !== "string") fail(store, `${k} not a string`);
  return v;
};
const strOrNull = (o: Obj, k: string, store: string): string | null => {
  const v = o[k];
  if (v !== null && typeof v !== "string") fail(store, `${k} not a string or null`);
  return v;
};
const num = (o: Obj, k: string, store: string): number => {
  const v = o[k];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(store, `${k} not a number`);
  return v;
};
const bool = (o: Obj, k: string, store: string): boolean => {
  const v = o[k];
  if (typeof v !== "boolean") fail(store, `${k} not a boolean`);
  return v;
};
function oneOf<T extends string>(o: Obj, k: string, values: readonly T[], store: string): T {
  const v = o[k];
  if (typeof v !== "string" || !(values as readonly string[]).includes(v))
    fail(store, `${k} invalid`);
  return v as T;
}

export function toAccount(value: unknown): AccountRecord {
  const s = "accounts";
  const o = object(value, s, ["schema", "id", "type", "user", "origin", "createdAt", "ready"]);
  return {
    schema: SCHEMA,
    id: str(o, "id", s),
    type: oneOf(o, "type", ["server", "local"], s),
    user: strOrNull(o, "user", s),
    origin: strOrNull(o, "origin", s),
    createdAt: num(o, "createdAt", s),
    ready: bool(o, "ready", s),
  };
}

export function toList(value: unknown): ListRecord {
  const s = "lists";
  const o = object(value, s, [
    "schema",
    "href",
    "displayName",
    "color",
    "order",
    "syncToken",
    "state",
    "deleted",
  ]);
  const order = o["order"];
  if (order !== null && (typeof order !== "number" || !Number.isFinite(order))) fail(s, "order");
  return {
    schema: SCHEMA,
    href: str(o, "href", s),
    displayName: str(o, "displayName", s),
    color: strOrNull(o, "color", s),
    order,
    syncToken: strOrNull(o, "syncToken", s),
    state: oneOf(o, "state", ["synced", "new"], s),
    deleted: bool(o, "deleted", s),
  };
}

export function toTask(value: unknown): TaskRecord {
  const s = "tasks";
  const o = object(value, s, [
    "schema",
    "href",
    "list",
    "uid",
    "ics",
    "etag",
    "deleted",
    "invalid",
  ]);
  return {
    schema: SCHEMA,
    href: str(o, "href", s),
    list: str(o, "list", s),
    uid: str(o, "uid", s),
    ics: str(o, "ics", s),
    etag: strOrNull(o, "etag", s),
    deleted: bool(o, "deleted", s),
    invalid: strOrNull(o, "invalid", s),
  };
}

export function toBase(value: unknown): BaseRecord {
  const s = "base";
  const o = object(value, s, ["schema", "href", "ics", "etag"]);
  return {
    schema: SCHEMA,
    href: str(o, "href", s),
    ics: str(o, "ics", s),
    etag: str(o, "etag", s),
  };
}

export function toOutbox(value: unknown): OutboxRecord {
  const s = "outbox";
  const o = object(value, s, ["schema", "id", "kind", "href", "groups", "editedAt"]);
  const groups = o["groups"];
  if (!Array.isArray(groups) || groups.some((g) => typeof g !== "string")) fail(s, "groups");
  return {
    schema: SCHEMA,
    id: num(o, "id", s),
    kind: oneOf(o, "kind", ["put", "delete", "mkcalendar", "proppatch", "deletelist"], s),
    href: str(o, "href", s),
    groups: groups as string[],
    editedAt: num(o, "editedAt", s),
  };
}

export function toConflict(value: unknown): ConflictRecord {
  const s = "conflicts";
  const o = object(value, s, ["schema", "id", "href", "uid", "group", "lines", "lost", "at"]);
  return {
    schema: SCHEMA,
    id: num(o, "id", s),
    href: str(o, "href", s),
    uid: str(o, "uid", s),
    group: str(o, "group", s),
    lines: str(o, "lines", s),
    lost: oneOf(o, "lost", ["local", "server"], s),
    at: num(o, "at", s),
  };
}
