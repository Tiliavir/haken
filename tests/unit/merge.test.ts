import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { merge } from "../../web/src/domain/merge.js";
import { applyEdit, createTask, parseResource, readTask } from "../../web/src/domain/vtodo.js";
import { fixture, lines } from "./helpers.js";

const T0 = new Date("2026-11-01T10:00:00Z");
const T1 = new Date("2026-11-02T10:00:00Z");
const T2 = new Date("2026-11-03T10:00:00Z");
const base = createTask(
  { uid: "m-1", summary: "Base", sortOrder: 1, parentUid: null, important: false, due: null },
  T0,
);
const view = (ics: string) => readTask(parseResource(ics));

describe("merge", () => {
  test("different properties on each side: both kept, no notes", () => {
    const local = applyEdit(base, { kind: "summary", value: "Local" }, T1).ics;
    const server = applyEdit(base, { kind: "important", value: true }, T2).ics;
    const r = merge(base, local, server, new Map([["SUMMARY", T1.getTime()]]));
    assert.equal(view(r.ics).summary, "Local");
    assert.equal(view(r.ics).important, true);
    assert.deepEqual(r.notes, []);
    assert.deepEqual(r.localWins, ["SUMMARY"]);
  });
  test("same property, local newer: local wins, server value kept as note", () => {
    const server = applyEdit(base, { kind: "summary", value: "Server" }, T1).ics;
    const local = applyEdit(base, { kind: "summary", value: "Local" }, T2).ics;
    const r = merge(base, local, server, new Map([["SUMMARY", T2.getTime()]]));
    assert.equal(view(r.ics).summary, "Local");
    assert.deepEqual(r.notes, [{ group: "SUMMARY", lines: "SUMMARY:Server", lost: "server" }]);
  });
  test("same property, server newer: server wins, local value kept as note", () => {
    const local = applyEdit(base, { kind: "summary", value: "Local" }, T1).ics;
    const server = applyEdit(base, { kind: "summary", value: "Server" }, T2).ics;
    const r = merge(base, local, server, new Map([["SUMMARY", T1.getTime()]]));
    assert.equal(r.ics, server);
    assert.deepEqual(r.notes, [{ group: "SUMMARY", lines: "SUMMARY:Local", lost: "local" }]);
    assert.deepEqual(r.localWins, []);
  });
  test("server without LAST-MODIFIED and DTSTAMP wins", () => {
    const local = applyEdit(base, { kind: "summary", value: "Local" }, T2).ics;
    const server = applyEdit(base, { kind: "summary", value: "Server" }, T1)
      .ics.replace(/LAST-MODIFIED:[^\r]*\r\n/, "")
      .replace(/DTSTAMP:[^\r]*\r\n/, "");
    const r = merge(base, local, server, new Map([["SUMMARY", T2.getTime()]]));
    assert.equal(view(r.ics).summary, "Server");
    assert.equal(r.notes[0]?.lost, "local");
  });
  test("completion is merged as one group", () => {
    const local = applyEdit(base, { kind: "done", value: true }, T2).ics;
    const server = applyEdit(base, { kind: "summary", value: "S" }, T1).ics;
    const r = merge(base, local, server, new Map([["COMPLETION", T2.getTime()]]));
    const v = view(r.ics);
    assert.equal(v.done, true);
    assert.equal(v.summary, "S");
    assert.match(r.ics, /PERCENT-COMPLETE:100/);
  });
  test("unknown properties added by the server survive a local win", () => {
    const original = fixture("thunderbird-tzid.ics");
    const server = original.replace("X-MOZ-GENERATION:3", "X-MOZ-GENERATION:4");
    const local = applyEdit(original, { kind: "summary", value: "Local" }, T2).ics;
    const r = merge(original, local, server, new Map([["SUMMARY", T2.getTime()]]));
    const out = new Set(lines(r.ics));
    assert.ok(out.has("X-MOZ-GENERATION:4"));
    assert.ok(out.has("SUMMARY:Local"));
    assert.ok(out.has("BEGIN:VTIMEZONE"));
  });
  test("no merge base (create raced): differences resolved by time", () => {
    const local = createTask(
      { uid: "m-2", summary: "Mine", sortOrder: 1, parentUid: null, important: false, due: null },
      T2,
    );
    const server = createTask(
      { uid: "m-2", summary: "Theirs", sortOrder: 1, parentUid: null, important: false, due: null },
      T1,
    );
    const r = merge(null, local, server, new Map([["SUMMARY", T2.getTime()]]));
    assert.equal(view(r.ics).summary, "Mine");
    assert.ok(r.notes.some((n) => n.group === "SUMMARY" && n.lost === "server"));
  });
  test("different UIDs throw", () => {
    const other = createTask(
      { uid: "other", summary: "", sortOrder: 1, parentUid: null, important: false, due: null },
      T0,
    );
    assert.throws(() => merge(base, base, other, new Map()));
  });
});
