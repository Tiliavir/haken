/** `config.json`: exact schema, unknown keys rejected (ADR-20261104-strict-errors). */
import { InvalidInputError } from "./errors.js";

export type AccountType = "server" | "local";

export interface AppConfig {
  readonly accounts: readonly AccountType[];
  readonly demo: boolean;
}

export function parseConfig(value: unknown): AppConfig {
  const fail = (reason: string): never => {
    throw new InvalidInputError("domain", "Invalid config.json", { reason });
  };
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return fail("not an object");
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "accounts" && key !== "demo") fail(`unknown key ${key}`);
  }
  const accounts = record["accounts"];
  if (!Array.isArray(accounts) || accounts.length === 0)
    return fail("accounts must be a non-empty array");
  const seen = new Set<AccountType>();
  for (const a of accounts) {
    if (a !== "server" && a !== "local") fail("accounts may contain only server and local");
    if (seen.has(a)) fail("duplicate account type");
    seen.add(a);
  }
  const demo = record["demo"];
  if (typeof demo !== "boolean") fail("demo must be a boolean");
  return { accounts: [...seen], demo: demo === true };
}
