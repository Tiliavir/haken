# 4. Solution Strategy

| Goal | Approach | ADR |
| --- | --- | --- |
| Offline for days | Local-first: UI reads/writes the local store only; sync runs separately | [Local store](adr/ADR-20261103-indexeddb-local-store.md), [Sync](adr/ADR-20261103-sync-strategy.md) |
| No data loss | Outbox + ETag-conditional writes + three-way merge | [Sync](adr/ADR-20261103-sync-strategy.md) |
| No data leak, no CORS | Same-origin Go gateway; HttpOnly session cookie | [Gateway](adr/ADR-20261103-go-stdlib-gateway.md) |
| Simplicity | TypeScript + platform APIs, no framework, no bundler; `ical.js` only runtime dependency | [Frontend](adr/ADR-20261103-vanilla-typescript-frontend.md) |
| Interoperability | Standard `VTODO` properties; `X-APPLE-SORT-ORDER` for order | [Data mapping](adr/ADR-20261103-vtodo-mapping.md) |
| Repeating tasks like Tasks.org | Completing advances the same `VTODO`; editable `RRULE` subset | [Recurrence](adr/ADR-20261104-recurrence.md) |
| One sync path | haken syncs CalDAV itself; DAVx⁵ only for other apps | [Own sync](adr/ADR-20261103-own-caldav-sync.md) |
| Optional server | Local account, `.ics` export | [Browser-only](adr/ADR-20261103-browser-only-mode.md) |
| One credential authority | Radicale authenticates and authorizes; gateway holds sessions | [Auth](adr/ADR-20261103-authentication.md) |
| Stability | W3C validation, lint, unit/integration/E2E and architecture tests at build time | [Quality gates](adr/ADR-20261103-build-time-quality-gates.md) |
| Errors are found and fixed | Fail fast; unexpected errors become precise tasks in the list "errorlogs" | [Strict errors](adr/ADR-20261104-strict-errors.md) |
| Multilingual, extensible | One flat JSON file per locale; `Intl` for plurals, dates, sorting | [i18n](adr/ADR-20261103-i18n-json-messages.md) |
| Readable in light and dark | `light-dark()` tokens; user accent adjusted to 4.5:1 contrast | [Theming](adr/ADR-20261103-theming.md) |
