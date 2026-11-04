import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig } from "../../web/src/domain/config.js";
import { InvalidInputError } from "../../web/src/domain/errors.js";

test("valid configs", () => {
  assert.deepEqual(parseConfig({ accounts: ["server", "local"], demo: false }), {
    accounts: ["server", "local"],
    demo: false,
  });
});
test("invalid configs", () => {
  for (const bad of [
    null,
    [],
    {},
    { accounts: [], demo: false },
    { accounts: ["cloud"], demo: false },
    { accounts: ["local"] },
    { accounts: ["local"], demo: false, x: 1 },
    { accounts: ["local", "local"], demo: false },
  ]) {
    assert.throws(() => parseConfig(bad), InvalidInputError, JSON.stringify(bad));
  }
});
