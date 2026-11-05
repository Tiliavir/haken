// Minimal declarations for the Node built-ins the tests (unit, browser, E2E) use. Avoids a
// dependency on @types/node; extend when a test needs more.
declare module "node:test" {
  type Fn = () => void | Promise<void>;
  export function test(name: string, fn: Fn): Promise<void>;
  export function describe(name: string, fn: () => void): void;
}
declare module "node:assert/strict" {
  interface Assert {
    (value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    ok(value: unknown, message?: string): asserts value;
    match(value: string, re: RegExp, message?: string): void;
    doesNotMatch(value: string, re: RegExp, message?: string): void;
    throws(fn: () => unknown, expected?: unknown, message?: string): void;
    fail(message?: string): never;
    rejects(fn: () => Promise<unknown>, expected?: unknown, message?: string): Promise<void>;
  }
  const assert: Assert;
  export default assert;
}
declare module "node:fs" {
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function readFileSync(path: string): Buffer;
  export function readdirSync(path: string, options?: { recursive?: boolean }): string[];
  interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function statSync(path: string): Stats;
  export function statSync(path: string, options: { throwIfNoEntry: false }): Stats | undefined;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
}
declare module "node:path" {
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
  export function dirname(path: string): string;
  export function resolve(...parts: string[]): string;
  export function extname(path: string): string;
  export function normalize(path: string): string;
}
declare module "node:child_process" {
  export function execFileSync(
    file: string,
    args: readonly string[],
    options?: { stdio?: "inherit" | "pipe"; encoding?: "utf8" },
  ): string | Uint8Array;
}
declare module "node:crypto" {
  export function createHash(algorithm: "sha256"): {
    update(data: Uint8Array | string): { digest(encoding: "hex"): string };
  };
}
declare const process: { cwd(): string; env: Record<string, string | undefined> };
declare class Buffer extends Uint8Array {
  static from(data: string, encoding?: "utf8"): Buffer;
  static alloc(size: number, fill?: number): Buffer;
  toString(encoding?: "base64" | "utf8"): string;
}
