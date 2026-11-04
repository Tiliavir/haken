# 5. Building Block View

## Frontend (`web/src/`)

| Layer | Responsibility | May import |
| --- | --- | --- |
| `domain/` | Task model, iCalendar mapping, merge, sort order. Pure, no browser APIs | `ical.js` |
| `store/` | IndexedDB: meta database `haken` (accounts, settings); per account `haken-account-<id>`: lists, tasks, merge base, outbox, conflict notes, sync state. Records validated on read; `commit()` applies all changes in one transaction | `domain/` |
| `net/` | All page requests: CalDAV, `/api`, and a same-origin loader for static files (locales, `config.json`) | `domain/` |
| `sync/` | Pull, push, conflict handling | `domain/`, `store/`, `net/` |
| `app/` | Commands (edit = store write + outbox entry), queries, events, loading locales and config, error tasks (`errors.ts`, [strict errors](adr/ADR-20261104-strict-errors.md)) | `domain/`, `store/`, `sync/`, `net/` |
| `ui/` | Custom Elements (`app-root.ts`, `screens/`), DOM builder (`dom.ts`, no `innerHTML`), icons, routes, drag and drop (`ui/dnd/`, the only code allowed to write `style.transform`), i18n (`i18n.ts`), theming (`theme.ts`), platform detection | `domain/`, `app/` |
| `main.ts` | Composition root: wires everything, registers the service worker | all |

`sw.ts` (service worker) is a separate entry point: it imports nothing and fetches only same-origin app-shell files (including `web/locales/*.json`) for its cache.

Message files live in `web/locales/` ([i18n](adr/ADR-20261103-i18n-json-messages.md)).

## Gateway (`gateway/`)

| Package | Responsibility | May import |
| --- | --- | --- |
| `internal/httpx` | Error ids, JSON responses, same-origin check | stdlib |
| `internal/static` | Embedded app, security headers | stdlib |
| `internal/session` | Login against Radicale, session store, rate limit | `internal/httpx` |
| `internal/proxy` | `/dav` reverse proxy, path restriction | `internal/session`, `internal/httpx` |
| `cmd/haken` | Config, wiring, `http.Server`, embedded app (`cmd/haken/dist`, filled by `make gateway`) | all |

## Build and tests

| Path | Content |
| --- | --- |
| `tools/build.mjs` | Assembles `dist/web` from `tsc` output and static files; writes the service worker's precache list |
| `tools/dev-run.sh` | Radicale (pip) + gateway for development and E2E |
| `tests/unit/` | `node:test` (domain, i18n, theme, architecture rules) |
| `tests/e2e/` | Playwright against gateway + Radicale |
| `tests/fixtures/vtodo/` | VTODO samples for round-trip and strict-input tests |
| `deploy/` | Container build, compose example, Radicale config example |

Rules are enforced by the architecture tests ([quality gates](adr/ADR-20261103-build-time-quality-gates.md)).
