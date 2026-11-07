// Assembles dist/web from the compiled TypeScript and the static files.
// Usage: node tools/build.mjs [--config <path>]
// Writes shell-manifest.json (the service worker's precache list) and stamps
// the service worker with a hash of the shell, so every change installs a
// new cache.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const out = join(root, "dist", "web");
const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const config = configIndex === -1 ? "web/config.json" : args[configIndex + 1];
if (config === undefined || !existsSync(config)) throw new Error(`config not found: ${config}`);

if (!existsSync(join(out, "src", "main.js")) || !existsSync(join(out, "src", "sw.js"))) {
  throw new Error("run tsc first: dist/web/src/main.js or sw.js missing");
}

// The app version: package.json `version`, stamped into the compiled module (ADR-20261105-implementation-baseline).
const appVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version;
if (typeof appVersion !== "string" || !/^\d+\.\d+\.\d+$/.test(appVersion))
  throw new Error(`package.json version is not x.y.z: ${appVersion}`);
const errorsPath = join(out, "src", "app", "errors.js");
const errorsJs = readFileSync(errorsPath, "utf8");
if (errorsJs.split("__HAKEN_VERSION__").length !== 2) throw new Error("app version marker missing");
writeFileSync(errorsPath, errorsJs.replace("__HAKEN_VERSION__", appVersion));

const copy = (from, to = from, filter = () => true) =>
  cpSync(join(root, "web", from), join(out, to), { recursive: true, filter: (src) => filter(src) });

// The released versions of CHANGELOG.md as changelog.json, for the in-app "What's new".
// Inline Markdown (emphasis, code, links) becomes plain text; the app renders text only.
function plain(text) {
  return text
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replaceAll(/[*`]/g, "")
    .trim();
}

function parseChangelog(markdown) {
  const entries = [];
  let entry = null;
  let section = null;
  for (const line of markdown.split("\n")) {
    const release = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(line);
    if (release !== null) {
      entry = { version: release[1], date: release[2], summary: "", sections: [] };
      section = null;
      entries.push(entry);
    } else if (line.startsWith("## ")) {
      entry = null; // [Unreleased] and anything else: not shipped.
    } else if (entry === null || line.trim() === "") {
      // outside a release, or a blank line
    } else if (line.startsWith("### ")) {
      section = { title: plain(line.slice(4)), items: [] };
      entry.sections.push(section);
    } else if (line.startsWith("- ") && section !== null) {
      section.items.push(plain(line.slice(2)));
    } else if (line.startsWith("  ") && section !== null && section.items.length > 0) {
      section.items[section.items.length - 1] += ` ${plain(line)}`;
    } else if (section === null) {
      entry.summary = plain(`${entry.summary} ${line}`);
    } else {
      throw new Error(`CHANGELOG.md: unexpected line in ${entry.version}: ${line}`);
    }
  }
  if (!entries.some((e) => e.version === appVersion))
    throw new Error(`CHANGELOG.md has no section for ${appVersion}`);
  return entries;
}

writeFileSync(
  join(out, "changelog.json"),
  `${JSON.stringify(parseChangelog(readFileSync(join(root, "CHANGELOG.md"), "utf8")), null, 2)}\n`,
);

copy("index.html");
copy("manifest.webmanifest");
copy("styles");
copy("locales");
copy("icons", "icons", (src) => !src.endsWith("README.md"));
copy(
  "vendor",
  "vendor",
  (src) => !src.endsWith(".d.ts") && !src.endsWith("README.md") && !src.includes("/types"),
);
cpSync(join(root, config), join(out, "config.json"));
renameSync(join(out, "src", "sw.js"), join(out, "sw.js"));

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(out)
  .map((p) => relative(out, p).replaceAll("\\", "/"))
  .filter((p) => p !== "sw.js" && p !== "shell-manifest.json" && !p.endsWith(".d.ts"))
  .sort();
const hash = createHash("sha256");
for (const f of files) hash.update(f).update(readFileSync(join(out, f)));
const version = hash.digest("hex").slice(0, 16);
writeFileSync(join(out, "shell-manifest.json"), `${JSON.stringify(files, null, 2)}\n`);
const swPath = join(out, "sw.js");
const sw = readFileSync(swPath, "utf8");
if (!sw.includes("__HAKEN_BUILD__")) throw new Error("service worker build marker missing");
writeFileSync(swPath, sw.replace("__HAKEN_BUILD__", version));
rmSync(join(out, "src", "sw.d.ts"), { force: true });
console.log(`dist/web: ${files.length} files, version ${appVersion}, shell ${version}`);
