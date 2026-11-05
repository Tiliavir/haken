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
  .map((p) => relative(out, p).split("\\").join("/"))
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
