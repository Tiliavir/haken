import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import { format, negotiate } from "../../web/src/ui/i18n.js";
import { ROOT } from "./helpers.js";

const DIR = join(ROOT, "web", "locales");
const load = (name: string): Record<string, string> =>
  JSON.parse(readFileSync(join(DIR, name), "utf8"));
const placeholders = (s: string): string[] =>
  [...s.matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1] as string).sort();

describe("locale files", () => {
  const en = load("en.json");
  const index = load("index.json");
  const files = readdirSync(DIR).filter((f) => f.endsWith(".json") && f !== "index.json");
  test("index.json lists exactly the locale files", () => {
    assert.deepEqual(
      Object.keys(index)
        .map((tag) => tag.toLowerCase())
        .sort(),
      files.map((f) => f.replace(/\.json$/, "")).sort(),
    );
  });
  for (const file of files) {
    test(`${file}: same keys and placeholders as en`, () => {
      const messages = load(file);
      assert.deepEqual(Object.keys(messages).sort(), Object.keys(en).sort());
      for (const [key, value] of Object.entries(messages)) {
        assert.equal(typeof value, "string", key);
        assert.deepEqual(placeholders(value), placeholders(en[key] ?? ""), `${file} ${key}`);
        assert.doesNotMatch(value, /<[a-z/]/i, `${file} ${key} contains markup`);
      }
    });
  }
});

test("de-CH is German with Swiss spelling: ss for ß, «» quotes", () => {
  const swiss = (s: string): string =>
    s.replaceAll("ß", "ss").replaceAll("„", "«").replaceAll("“", "»");
  const de = load("de.json");
  assert.deepEqual(
    load("de-ch.json"),
    Object.fromEntries(Object.entries(de).map(([k, v]) => [k, swiss(v)])),
  );
});

describe("negotiation and formatting", () => {
  const available = ["en", "de", "fr", "es", "it"];
  test("setting wins, then exact, then language, then en", () => {
    assert.equal(negotiate("fr", ["de-CH"], available), "fr");
    assert.equal(negotiate(null, ["de-CH", "en"], available), "en");
    assert.equal(negotiate(null, ["de-CH"], available), "de");
    assert.equal(negotiate(null, ["de-CH"], [...available, "de-CH"]), "de-CH");
    assert.equal(negotiate(null, ["de-AT"], [...available, "de-CH"]), "de");
    assert.equal(negotiate(null, ["pt-BR"], available), "en");
    assert.equal(negotiate("xx", ["it"], available), "it");
  });
  test("placeholders are plain text, missing ones throw", () => {
    assert.equal(format("Hi {name}", { name: "<b>" }), "Hi <b>");
    assert.throws(() => format("Hi {name}", {}));
  });
});
