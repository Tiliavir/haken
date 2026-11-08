// Architecture rules (ADR-20261103-build-time-quality-gates, chapter 5).
// A plain scanner over the sources: Biome formatting keeps import
// statements regular, so no parser is needed.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, test } from "node:test";
import { ROOT } from "./helpers.js";

const SRC = join(ROOT, "web", "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Module specifiers of static imports, re-exports, side-effect imports and dynamic imports. */
export function specifiers(source: string): string[] {
  const out: string[] = [];
  const re =
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?"([^"]+)"|import\(\s*"([^"]+)"\s*\)/gms;
  for (const m of source.matchAll(re)) out.push((m[1] ?? m[2]) as string);
  return out;
}

const ALLOWED: Readonly<Record<string, readonly string[]>> = {
  domain: ["domain", "vendor"],
  store: ["domain", "store"],
  net: ["domain", "net"],
  sync: ["domain", "store", "net", "sync"],
  app: ["domain", "store", "net", "sync", "app"],
  ui: ["domain", "app", "ui", "locales"],
  main: ["domain", "store", "net", "sync", "app", "ui"],
};

function layerOf(file: string): string {
  const rel = relative(SRC, file).split("\\").join("/");
  if (rel === "main.ts") return "main";
  if (rel === "sw.ts") return "sw";
  return rel.split("/")[0] as string;
}

function targetLayer(file: string, spec: string): string {
  const target = relative(join(ROOT, "web"), resolve(dirname(file), spec))
    .split("\\")
    .join("/");
  if (target.startsWith("vendor/")) return "vendor";
  if (target.startsWith("locales/")) return "locales";
  if (!target.startsWith("src/")) return `outside:${target}`;
  return layerOf(join(ROOT, "web", target));
}

const files = walk(SRC);
const code = (f: string): string => readFileSync(f, "utf8");
const rel = (f: string): string => relative(ROOT, f);

describe("scanner", () => {
  test("finds single-line, wrapped, type, re-export, side-effect and dynamic imports", () => {
    const src = [
      'import { a } from "./a.js";',
      "import {",
      "  b,",
      "  c,",
      '} from "./b.js";',
      'import type { D } from "./d.js";',
      'export { e } from "./e.js";',
      'import "./f.js";',
      'const g = await import("./g.js");',
    ].join("\n");
    assert.deepEqual(specifiers(src), ["./a.js", "./b.js", "./d.js", "./e.js", "./f.js", "./g.js"]);
  });
});

describe("layers", () => {
  for (const file of files) {
    const layer = layerOf(file);
    test(`${rel(file)} imports only allowed layers`, () => {
      for (const spec of specifiers(code(file))) {
        if (layer === "sw") assert.fail(`sw.ts must import nothing, found ${spec}`);
        assert.ok(spec.startsWith("."), `${rel(file)}: bare import ${spec}`);
        const target = targetLayer(file, spec);
        assert.ok(
          ALLOWED[layer]?.includes(target),
          `${rel(file)}: ${layer} must not import ${target} (${spec})`,
        );
      }
    });
  }
});

describe("rules", () => {
  const offenders = (pattern: RegExp, allowed: (f: string) => boolean): string[] =>
    files.filter((f) => !allowed(f) && pattern.test(code(f))).map(rel);

  test("only net/ and sw.ts call fetch", () => {
    assert.deepEqual(
      offenders(/\bfetch\(/, (f) => layerOf(f) === "net" || layerOf(f) === "sw"),
      [],
    );
  });
  test("only store/ touches IndexedDB", () => {
    assert.deepEqual(
      offenders(/\bindexedDB\b|\bIDB[A-Z]\w*/, (f) => layerOf(f) === "store"),
      [],
    );
  });
  test("only domain/ imports ical.js", () => {
    const bad = files.filter(
      (f) => layerOf(f) !== "domain" && specifiers(code(f)).some((s) => s.includes("ical.js")),
    );
    assert.deepEqual(bad.map(rel), []);
  });
  test("no HTML injection sinks, eval or inline handlers", () => {
    const sinks =
      /\.innerHTML\b|\.outerHTML\s*=|insertAdjacentHTML|document\.write|\beval\(|new Function\b|setAttribute\(\s*"on/;
    assert.deepEqual(
      offenders(sinks, () => false),
      [],
    );
  });
  test("no inline CSS: style writes only in ui/dnd/", () => {
    const style = /\.style\.|\.style\s*=|setAttribute\(\s*"style"|cssText/;
    assert.deepEqual(
      offenders(style, (f) => rel(f).startsWith("web/src/ui/dnd/")),
      [],
    );
    const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
    assert.doesNotMatch(html, /\sstyle\s*=|<style[\s>]/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, "inline event handler in index.html");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, "inline script in index.html");
  });
  // no-referrer makes Firefox send Origin: null, which the gateway refuses. The page's policy
  // comes only from the gateway header (static.go, asserted in its test), not from a meta tag.
  test("fetch referrer policy is same-origin; no referrer meta tag", () => {
    const policies = files.flatMap((f) =>
      [...code(f).matchAll(/referrerPolicy:\s*"([^"]*)"/g)].map((m) => m[1]),
    );
    assert.ok(policies.length > 0, "no referrerPolicy found");
    assert.deepEqual([...new Set(policies)], ["same-origin"]);
    const html = readFileSync(join(ROOT, "web", "index.html"), "utf8");
    assert.doesNotMatch(html, /<meta[^>]+name="referrer"/i);
  });
  test("package.json has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(pkg["dependencies"], undefined);
  });
});
