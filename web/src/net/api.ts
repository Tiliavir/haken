/** Gateway `/api` endpoints ([Auth](../../../docs/arc42/adr/ADR-20261103-authentication.md)). */
import { HakenError } from "../domain/errors.js";
import { server, UnreachableError } from "./http.js";

export type Probe =
  | { readonly kind: "online"; readonly user: string }
  | { readonly kind: "expired" }
  | { readonly kind: "unreachable" };

const PROBE_TIMEOUT_MS = 8_000;

/** Reachability probe (ADR-20261103-sync-strategy): anything but the exact answers means offline. */
export async function probe(expectedUser: string): Promise<Probe> {
  let response: Awaited<ReturnType<typeof server>>;
  try {
    response = await server("GET", "/api/session", {
      headers: { Accept: "application/json" },
      timeoutMs: PROBE_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof UnreachableError) return { kind: "unreachable" };
    throw error;
  }
  if (response.status === 401) return { kind: "expired" };
  if (response.status !== 200) return { kind: "unreachable" };
  const user = sessionUser(response.text);
  if (user === null || user !== expectedUser) return { kind: "unreachable" };
  return { kind: "online", user };
}

function sessionUser(text: string): string | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const keys = Object.keys(value);
  const user = (value as Record<string, unknown>)["user"];
  if (keys.length !== 1 || typeof user !== "string" || user === "") return null;
  return user;
}

export type Login =
  | { readonly kind: "ok"; readonly user: string }
  | { readonly kind: "invalid" }
  | { readonly kind: "rate-limited"; readonly retryAfterSeconds: number }
  | { readonly kind: "unreachable" }
  | { readonly kind: "insecure" };

export async function login(user: string, password: string): Promise<Login> {
  // Never send a password over plain HTTP (localhost counts as secure).
  if (!globalThis.isSecureContext) return { kind: "insecure" };
  let response: Awaited<ReturnType<typeof server>>;
  try {
    response = await server("POST", "/api/session", {
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ user, password }),
    });
  } catch (error) {
    if (error instanceof UnreachableError) return { kind: "unreachable" };
    throw error;
  }
  switch (response.status) {
    case 200: {
      const confirmed = sessionUser(response.text);
      if (confirmed !== user) {
        throw new HakenError("net", "Unexpected /api/session response", {
          method: "POST",
          path: "/api/session",
          status: 200,
        });
      }
      return { kind: "ok", user };
    }
    case 401:
      return { kind: "invalid" };
    case 429: {
      const retry = Number(response.headers.get("Retry-After"));
      if (!Number.isInteger(retry) || retry < 0) {
        throw new HakenError("net", "429 without valid Retry-After", {
          path: "/api/session",
          status: 429,
        });
      }
      return { kind: "rate-limited", retryAfterSeconds: retry };
    }
    case 404:
      // No gateway (static host).
      return { kind: "unreachable" };
    default:
      throw new HakenError("net", "Unexpected /api/session status", {
        method: "POST",
        path: "/api/session",
        status: response.status,
        ...errorId(response.text),
      });
  }
}

export async function logout(): Promise<"ok" | "unreachable"> {
  try {
    const response = await server("DELETE", "/api/session");
    if (response.status !== 204 && response.status !== 401) {
      throw new HakenError("net", "Unexpected logout status", {
        method: "DELETE",
        path: "/api/session",
        status: response.status,
      });
    }
    return "ok";
  } catch (error) {
    if (error instanceof UnreachableError) return "unreachable";
    throw error;
  }
}

/** The gateway's `{"errorId": "…"}` on 500, for matching client and server logs. */
export function errorId(text: string): { errorId?: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value === "object" && value !== null) {
      const id = (value as Record<string, unknown>)["errorId"];
      if (typeof id === "string" && /^[a-f0-9]{16}$/.test(id)) return { errorId: id };
    }
  } catch {
    // Not JSON: no error id to report.
  }
  return {};
}
