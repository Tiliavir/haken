/** Hash routes: they work on any static host (GitHub Pages) and keep the back button useful. */
import { HakenError } from "../domain/errors.js";

export type SmartId = "focus" | "important" | "planned" | "all";
export const SMART: readonly SmartId[] = ["focus", "important", "planned", "all"];

export type ListId =
  | { readonly kind: "smart"; readonly id: SmartId }
  | { readonly kind: "list"; readonly href: string };

export type Route =
  | { readonly kind: "lists" }
  | { readonly kind: "list"; readonly list: ListId }
  | { readonly kind: "task"; readonly list: ListId; readonly task: string }
  | { readonly kind: "settings" };

function encodeList(list: ListId): string {
  return list.kind === "smart" ? `smart/${list.id}` : `list/${encodeURIComponent(list.href)}`;
}

export function toHash(route: Route): string {
  switch (route.kind) {
    case "lists":
      return "#/";
    case "settings":
      return "#/settings";
    case "list":
      return `#/${encodeList(route.list)}`;
    case "task":
      return `#/${encodeList(route.list)}/task/${encodeURIComponent(route.task)}`;
  }
}

/** Unknown hashes go to the lists screen; a hash is navigation input, not data. */
export function parseHash(hash: string): Route {
  const parts = hash
    .replace(/^#\/?/, "")
    .split("/")
    .filter((p) => p !== "");
  if (parts.length === 0) return { kind: "lists" };
  if (parts[0] === "settings" && parts.length === 1) return { kind: "settings" };
  let list: ListId | null = null;
  if (parts[0] === "smart" && SMART.includes(parts[1] as SmartId))
    list = { kind: "smart", id: parts[1] as SmartId };
  if (parts[0] === "list" && parts[1] !== undefined) {
    try {
      list = { kind: "list", href: decodeURIComponent(parts[1]) };
    } catch {
      return { kind: "lists" };
    }
  }
  if (list === null) return { kind: "lists" };
  if (parts.length === 2) return { kind: "list", list };
  if (parts.length === 4 && parts[2] === "task" && parts[3] !== undefined) {
    try {
      return { kind: "task", list, task: decodeURIComponent(parts[3]) };
    } catch {
      return { kind: "list", list };
    }
  }
  return { kind: "lists" };
}

export function sameList(a: ListId, b: ListId): boolean {
  return a.kind === "smart"
    ? b.kind === "smart" && a.id === b.id
    : b.kind === "list" && a.href === b.href;
}

export function assertNever(value: never): never {
  throw new HakenError("ui", "Unhandled route", { value: String(value) });
}
