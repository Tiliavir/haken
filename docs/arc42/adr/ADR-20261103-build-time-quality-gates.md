# ADR-20261103: Build-time quality gates

Status: Accepted

## Decision

All checks run at build time in pinned containers, locally (`make check`) and in CI the same way. None adds a runtime dependency.

| Gate | Tool | Fails on |
| --- | --- | --- |
| Types | `tsc --noEmit` (TypeScript 7, native), strictest flags | Any type error |
| Lint + format (TS, CSS, JSON) | Biome 2 (single binary), incl. `noFloatingPromises`, `noImportCycles` | Any finding, unformatted file |
| HTML, CSS, SVG validity | W3C Nu Html Checker (`vnu`) | Any error on `index.html`, templates, CSS, icons |
| Rendered DOM validity | `vnu` on DOM snapshots taken during E2E | Any error |
| No inline CSS | Own test on sources + CSP `style-src 'self'` | `style=` attribute, `<style>` element, `style.*` write outside `ui/dnd/` |
| Go | `gofmt -l`, `go vet`, `staticcheck` | Any finding |
| Unit tests (logic) | `node:test` (built in), `go test` | Any failure |
| Integration | `go test` + Docker Compose with real Radicale | Any failure |
| E2E | Playwright container vs. gateway + Radicale | Any failure, request to a foreign origin |
| Interop | Round-trip fixtures from Tasks.org, Thunderbird, Apple | Any changed unknown property |
| Architecture | Own `node:test` import scanner; `go list -deps` test in Go | Rule violation (below) |

Architecture rules:

- Layer dependencies as in [chapter 5](../05-building-block-view.md); no cycles.
- Only `net/` calls `fetch`. `net/` offers two kinds of requests: CalDAV and `/api` calls, and one loader for the app's own static files (locales, `config.json`), which accepts only relative paths and sends no credentials. Exception: `sw.ts`, a separate entry point that imports nothing and may fetch only same-origin app-shell files for its cache.
- Only `store/` touches IndexedDB; only `domain/` imports `ical.js`.
- No `innerHTML`, `insertAdjacentHTML`, `eval`, `new Function`, inline event handlers.
- `package.json` has no `dependencies`; `ical.js` is vendored. `go.mod` has no `require`.

E2E covers: offline edit then reconnect, two clients editing the same task, drag-and-drop order, logout with pending changes.

No ESLint.

## Why

- Stability comes from catching errors before deployment, not at runtime.
- `vnu` is the W3C's own validator and runs offline.
- ESLint's type-aware rules need the classic TypeScript compiler API; TypeScript 7 does not expose it before 7.1. Keeping TS 6 only for linting means two compilers. Biome 2 covers the rule that matters most here (floating promises, i.e. unawaited IndexedDB writes) without the compiler, at partial coverage; E2E and store tests close the gap. Revisit when typescript-eslint supports TS 7.1.
- The import scanner is ~50 lines on `node:test`. It reads each file as a whole and matches the module specifier of `import … from "…"`, `export … from "…"`, `import "…"` and `import("…")`, across line breaks: Biome wraps long named imports over several lines. Biome formatting keeps these forms regular (double quotes, no comments inside specifiers), so no parser is needed; a fixture test covers single-line, wrapped and side-effect imports.
- The `fetch` rule exists so that every network request can be audited and mocked in one place. Loading the app's own files is network access too, so it goes through `net/` as well; the static loader cannot reach other origins or carry credentials. The service worker runs in its own context and cannot share modules with the page, so it gets its own narrower rule.
- Drag and drop needs `transform` writes during a gesture; that is the only allowed CSSOM write.
- Containers make local and CI results identical.
