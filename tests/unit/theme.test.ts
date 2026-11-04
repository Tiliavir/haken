import assert from "node:assert/strict";
import { test } from "node:test";
import {
  contrast,
  DEFAULT_ACCENT,
  deriveAccent,
  fromOklch,
  onColour,
  parseHex,
  toHex,
  toOklch,
} from "../../web/src/ui/theme.js";

test("default accent keeps the brand values", () => {
  assert.deepEqual(deriveAccent(DEFAULT_ACCENT), {
    light: "#1f4d45",
    dark: "#618f86",
    onLight: "#ffffff",
    onDark: "#000000",
  });
});

test("any accent reaches 4.5:1 against both backgrounds of each scheme", () => {
  const samples = [
    "#ffff00",
    "#00ff00",
    "#0000ff",
    "#ff0000",
    "#808080",
    "#ffffff",
    "#000000",
    "#12ab34",
    "#f0a0c0",
  ];
  for (const hex of samples) {
    const a = deriveAccent(hex);
    for (const bg of ["#ffffff", "#f5f6f7"])
      assert.ok(contrast(a.light, bg) >= 4.5, `${hex} light on ${bg}`);
    for (const bg of ["#121416", "#1c1f22"])
      assert.ok(contrast(a.dark, bg) >= 4.5, `${hex} dark on ${bg}`);
    assert.ok(
      contrast(a.onLight, a.light) >= 4.5 ||
        contrast(a.onLight, a.light) >=
          contrast(onColour(a.light) === "#000000" ? "#ffffff" : "#000000", a.light),
    );
  }
});

test("OKLCH round trip", () => {
  for (const hex of ["#1f4d45", "#618f86", "#ff8800", "#123456"]) {
    assert.equal(toHex(fromOklch(toOklch(parseHex(hex)))), hex);
  }
});

test("invalid colours throw", () => {
  assert.throws(() => parseHex("red"));
  assert.throws(() => deriveAccent("#12345"));
});
