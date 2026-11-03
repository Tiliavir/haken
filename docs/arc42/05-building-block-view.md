# 5. Building Block View

## Frontend (`web/src/`)

| Layer | Responsibility | May import |
| --- | --- | --- |
| `domain/` | Task model, iCalendar mapping, merge, sort order. Pure, no browser APIs | `ical.js` |
| `store/` | IndexedDB: meta database (accounts, active account, setup step, device settings); per account: tasks, merge base, outbox, conflict notes | `domain/` |
| `net/` | All page requests: CalDAV, `/api`, and a same-origin loader for static files (locales, `config.json`) | `domain/` |
| `sync/` | Pull, push, conflict handling | `domain/`, `store/`, `net/` |
| `app/` | Commands (edit = store write + outbox entry), queries, events, loading locales and config | `domain/`, `store/`, `sync/`, `net/` |
| `ui/` | Custom Elements, templates, setup screens, drag and drop (`ui/dnd/`, the only code allowed to write `style.transform`), i18n (`i18n.ts`), theming (`theme.ts`) | `domain/`, `app/` |
| `main.ts` | Composition root: wires everything, registers the service worker | all |

`sw.ts` (service worker) is a separate entry point: it imports nothing and fetches only same-origin app-shell files (including `web/locales/*.json`) for its cache.

Message files live in `web/locales/` ([i18n](adr/ADR-20261103-i18n-json-messages.md)).

## Gateway (`gateway/`)

| Package | Responsibility | May import |
| --- | --- | --- |
| `internal/static` | Embedded app, security headers | stdlib |
| `internal/session` | Login against Radicale, session store, rate limit | stdlib |
| `internal/proxy` | `/dav` reverse proxy, path restriction | `internal/session` |
| `cmd/haken` | Config, wiring, `http.Server` | all |

Rules are enforced by the architecture tests ([quality gates](adr/ADR-20261103-build-time-quality-gates.md)).
