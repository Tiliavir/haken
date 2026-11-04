import assert from "node:assert/strict";
import { test } from "node:test";
import { separateAppStorage } from "../../web/src/ui/platform.js";
import { parseHash, toHash } from "../../web/src/ui/route.js";

test("separate app storage detection", () => {
  const cases: [string, number, boolean][] = [
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
      5,
      true,
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1",
      5,
      true,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      5,
      true,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
      0,
      true,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
      0,
      false,
    ],
    [
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
      5,
      false,
    ],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0", 0, false],
  ];
  for (const [ua, touch, want] of cases) assert.equal(separateAppStorage(ua, touch), want, ua);
});

test("routes round-trip; garbage goes to the lists screen", () => {
  const routes = [
    { kind: "lists" },
    { kind: "settings" },
    { kind: "list", list: { kind: "smart", id: "focus" } },
    { kind: "list", list: { kind: "list", href: "/dav/u/a b/" } },
    { kind: "task", list: { kind: "list", href: "/dav/u/x/" }, task: "/dav/u/x/1.ics" },
  ] as const;
  for (const r of routes) assert.deepEqual(parseHash(toHash(r)), r);
  for (const bad of ["#/nope", "#/smart/bogus", "#/list/%E0%A4%A", "#/list/x/task"]) {
    assert.deepEqual(parseHash(bad), { kind: "lists" }, bad);
  }
});
