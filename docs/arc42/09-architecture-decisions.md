# 9. Architecture Decisions

One file per decision in [`adr/`](adr/), named `ADR-YYYYMMDD-short-title.md`.
Status: `Proposed` → `Accepted` | `Rejected` | `Superseded by …`.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-20261103-own-caldav-sync](adr/ADR-20261103-own-caldav-sync.md) | haken syncs via CalDAV itself, not via DAVx⁵ | Accepted |
| [ADR-20261103-go-stdlib-gateway](adr/ADR-20261103-go-stdlib-gateway.md) | Backend: one Go binary, stdlib only | Accepted |
| [ADR-20261103-vanilla-typescript-frontend](adr/ADR-20261103-vanilla-typescript-frontend.md) | Frontend: TypeScript, Custom Elements, no framework, no bundler | Accepted |
| [ADR-20261103-indexeddb-local-store](adr/ADR-20261103-indexeddb-local-store.md) | Local store: IndexedDB, not `localStorage` | Accepted |
| [ADR-20261103-sync-strategy](adr/ADR-20261103-sync-strategy.md) | Outbox, triggers, ETag writes, three-way merge | Accepted |
| [ADR-20261103-vtodo-mapping](adr/ADR-20261103-vtodo-mapping.md) | Feature → iCalendar property mapping | Accepted |
| [ADR-20261103-browser-only-mode](adr/ADR-20261103-browser-only-mode.md) | Local account without any server | Accepted |
| [ADR-20261103-authentication](adr/ADR-20261103-authentication.md) | Radicale authenticates; gateway session for the PWA | Accepted |
| [ADR-20261103-build-time-quality-gates](adr/ADR-20261103-build-time-quality-gates.md) | Validation, lint, tests, architecture rules in containers | Accepted |
| [ADR-20261103-first-start-setup](adr/ADR-20261103-first-start-setup.md) | First start: explicit, resumable setup; install first where app storage is separate | Accepted |
| [ADR-20261103-i18n-json-messages](adr/ADR-20261103-i18n-json-messages.md) | i18n: flat JSON per locale, `Intl`, typed keys; en/de/fr/es/it bundled | Accepted |
| [ADR-20261103-theming](adr/ADR-20261103-theming.md) | `light-dark()` tokens, appearance override, contrast-safe custom accent | Accepted |
| [ADR-20261104-strict-errors](adr/ADR-20261104-strict-errors.md) | Fail fast, strict input validation; unexpected errors become tasks in the list "errorlogs" | Accepted |
| [ADR-20261104-today](adr/ADR-20261104-today.md) | *Today*: due/overdue first, then tasks put on Today; no daily reset; overdue red | Accepted |
| [ADR-20261104-recurrence](adr/ADR-20261104-recurrence.md) | Repeating tasks: completing advances the same task; editable `RRULE` subset; overrides stay unreadable | Accepted |
