/**
 * The only place that calls `fetch` (architecture rule). Two kinds of
 * requests: same-origin server requests (`/dav/…`, `/api/…`) with the session
 * cookie, and the static loader for the app's own files without credentials.
 */
import { HakenError } from "../domain/errors.js";

export interface ServerResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
}

/** Network failure or timeout: the server is unreachable. An expected state, not an error. */
export class UnreachableError extends Error {
  override readonly name: string = "UnreachableError";
}

const TIMEOUT_MS = 30_000;
const SERVER_PATH = /^\/(dav|api)\/[^?#]*$/;

let basePath = "/";

/** Path prefix the app is served under (e.g. `/` or `/haken/`); set once at start. */
export function setBasePath(path: string): void {
  if (!/^\/([^/?#]+\/)*$/.test(path)) throw new HakenError("net", "Invalid base path", { path });
  basePath = path;
}

export async function server(
  method: string,
  path: string,
  init: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<ServerResponse> {
  if (!SERVER_PATH.test(path))
    throw new HakenError("net", "Server path outside /dav or /api", { method });
  let response: Response;
  try {
    response = await fetch(`${basePath}${path.slice(1)}`, {
      method,
      headers: init.headers ?? {},
      ...(init.body === undefined ? {} : { body: init.body }),
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      mode: "same-origin",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    });
  } catch (cause) {
    if (
      cause instanceof TypeError ||
      (cause instanceof DOMException && cause.name === "TimeoutError")
    ) {
      throw new UnreachableError(method, { cause });
    }
    throw cause;
  }
  const text = await response.text();
  return { status: response.status, headers: response.headers, text };
}

const STATIC_PATH = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.json$/;

/** Loads one of the app's own JSON files (locales, config) by relative path. */
export async function staticJson(path: string): Promise<unknown> {
  if (!STATIC_PATH.test(path)) throw new HakenError("net", "Static path not allowed", { path });
  const response = await fetch(`${basePath}${path}`, {
    credentials: "omit",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  if (response.status !== 200) {
    throw new HakenError("net", "Static file not loaded", { path, status: response.status });
  }
  try {
    return (await response.json()) as unknown;
  } catch (cause) {
    throw new HakenError("net", "Static file is not valid JSON", { path }, { cause });
  }
}
