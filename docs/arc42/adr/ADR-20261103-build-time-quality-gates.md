# ADR-20261103: Build-time quality gates

Status: Proposed

## Decision

All checks run at build time in pinned containers, locally (`make check`) and in CI the same way. None adds a runtime dependency.

| Gate | Tool | Fails on |
| --- | --- | --- |
| Types | `tsc --noEmit`, strictest flags | Any type error |
| Lint + format (TS, CSS, JSON) | Biome (single binary) | Any finding, unformatted file |
| HTML, CSS, SVG validity | W3C Nu Html Checker (`vnu`) | Any error on `index.html`, templates, CSS, icons |
| Rendered DOM validity | `vnu` on DOM snapshots taken during E2E | Any error |
| Go | `gofmt -l`, `go vet`, `staticcheck` | Any finding |
| Unit tests (logic) | `node:test` (built in), `go test` | Any failure |
| Integration | `go test` + Docker Compose with real Radicale | Any failure |
| E2E | Playwright container vs. gateway + Radicale | Any failure, request to a foreign origin |
| Interop | Round-trip fixtures from Tasks.org, Thunderbird, Apple | Any changed unknown property |
| Architecture | Own test using the TypeScript compiler API; `go list` test in Go | Rule violation (below) |

Architecture rules (initial):

- Only `net/` calls `fetch`; only `store/` touches IndexedDB; `ui/` never imports `net/` or `sync/`.
- No `innerHTML`, `eval`, `new Function`, inline handlers.
- `package.json` has no `dependencies`; only `ical.js` is vendored. `go.mod` has no `require`.

E2E covers: offline edit then reconnect, two clients editing the same task, drag-and-drop order, logout wipe.

## Why

- Stability comes from catching errors before deployment, not at runtime.
- `vnu` is the W3C's own validator and runs offline.
- `node:test` and the compiler API reuse tools we already need; Biome replaces ESLint + Prettier and their plugin trees with one binary.
- Containers make local and CI results identical.
