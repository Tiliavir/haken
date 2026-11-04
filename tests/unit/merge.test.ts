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
  describe("labels and attachments merge as sets, without notes", () => {
    const labels = (ics: string, value: string[]) =>
      applyEdit(ics, { kind: "categories", value }, T1).ics;
    const attach = (ics: string, filename: string, base64 = "aGk=") =>
      applyEdit(ics, { kind: "addAttachment", filename, mediaType: "text/plain", base64 }, T1).ics;
    const names = (ics: string) =>
      view(ics).attachments.map((a) => (a.kind === "binary" ? a.filename : a.uri));
    const labelled = labels(base, ["a", "b"]);

    test("change on one side only is taken", () => {
      const local = labels(labelled, ["a", "b", "c"]);
      const r = merge(labelled, local, labelled, new Map([["CATEGORIES", T2.getTime()]]));
      assert.deepEqual(view(r.ics).categories, ["a", "b", "c"]);
      assert.deepEqual(r.notes, []);
      const server = labels(labelled, ["a"]);
      const r2 = merge(labelled, labelled, server, new Map());
      assert.equal(r2.ics, server);
      assert.deepEqual(r2.localWins, []);
    });
    test("both sides add: union", () => {
      const local = labels(labelled, ["a", "b", "local"]);
      const server = labels(labelled, ["a", "b", "server"]);
      const r = merge(labelled, local, server, new Map([["CATEGORIES", T1.getTime()]]));
      assert.deepEqual(view(r.ics).categories, ["a", "b", "server", "local"]);
      assert.deepEqual(r.notes, []);
      assert.deepEqual(r.localWins, ["CATEGORIES"]);
    });
    test("local remove and server add: both applied", () => {
      const local = labels(labelled, ["b"]);
      const server = labels(labelled, ["a", "b", "server"]);
      const r = merge(labelled, local, server, new Map([["CATEGORIES", T1.getTime()]]));
      assert.deepEqual(view(r.ics).categories, ["b", "server"]);
      assert.deepEqual(r.notes, []);
    });
    test("removal keeps other labels and parameters of a server property", () => {
      const server = labelled.replace("CATEGORIES:a,b", "CATEGORIES;LANGUAGE=de:a,b,x");
      const local = labels(labelled, ["b"]);
      const r = merge(labelled, local, server, new Map([["CATEGORIES", T1.getTime()]]));
      assert.ok(lines(r.ics).includes("CATEGORIES;LANGUAGE=de:b,x"));
    });
    test("both sides add the same label: nothing to push", () => {
      const local = labels(labelled, ["a", "b", "c"]);
      const server = applyEdit(labelled, { kind: "categories", value: ["a", "b", "c"] }, T2).ics;
      const r = merge(labelled, local, server, new Map([["CATEGORIES", T1.getTime()]]));
      assert.equal(r.ics, server);
      assert.deepEqual(r.localWins, []);
    });
    test("no merge base: union", () => {
      const local = labels(base, ["a", "local"]);
      const server = labels(base, ["a", "server"]);
      const r = merge(null, local, server, new Map([["CATEGORIES", T1.getTime()]]));
      assert.deepEqual(view(r.ics).categories, ["a", "server", "local"]);
      assert.deepEqual(r.notes, []);
    });
    test("attachments: both add, local removes one the server kept", () => {
      const withOne = attach(base, "one.txt");
      const local = applyEdit(
        attach(withOne, "local.txt"),
        { kind: "removeAttachment", index: 0 },
        T1,
      ).ics;
      const server = attach(withOne, "server.txt");
      const r = merge(withOne, local, server, new Map([["ATTACH", T1.getTime()]]));
      assert.deepEqual(names(r.ics), ["server.txt", "local.txt"]);
      assert.deepEqual(r.notes, []);
    });
    test("attachment with different parameters counts as different", () => {
      const withOne = attach(base, "one.txt");
      const local = withOne.replace("FILENAME=one.txt", "FILENAME=renamed.txt");
      const server = attach(withOne, "server.txt");
      const r = merge(withOne, local, server, new Map([["ATTACH", T1.getTime()]]));
      assert.deepEqual(names(r.ics), ["server.txt", "renamed.txt"]);
      assert.deepEqual(r.notes, []);
    });
    test("no merge base: attachments are united", () => {
      const local = attach(base, "local.txt");
      const server = attach(base, "server.txt", "aGkh");
      const r = merge(null, local, server, new Map([["ATTACH", T1.getTime()]]));
      assert.deepEqual(names(r.ics), ["server.txt", "local.txt"]);
    });
  });
  test("different UIDs throw", () => {
    const other = createTask(
      { uid: "other", summary: "", sortOrder: 1, parentUid: null, important: false, due: null },
      T0,
    );
    assert.throws(() => merge(base, base, other, new Map()));
  });
});
