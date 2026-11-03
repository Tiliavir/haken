# 9. Architecture Decisions

One file per decision in [`adr/`](adr/), named `ADR-YYYYMMDD-short-title.md`.
Status: `Proposed` → `Accepted` | `Rejected` | `Superseded by …`.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-20261103-own-caldav-sync](adr/ADR-20261103-own-caldav-sync.md) | haken syncs via CalDAV itself, not via DAVx⁵ | Proposed |
| [ADR-20261103-go-stdlib-gateway](adr/ADR-20261103-go-stdlib-gateway.md) | Backend: one Go binary, stdlib only | Proposed |
| [ADR-20261103-vanilla-typescript-frontend](adr/ADR-20261103-vanilla-typescript-frontend.md) | Frontend: TypeScript, Custom Elements, no framework, no bundler | Proposed |
| [ADR-20261103-indexeddb-local-store](adr/ADR-20261103-indexeddb-local-store.md) | Local store: IndexedDB, not `localStorage` | Proposed |
| [ADR-20261103-sync-strategy](adr/ADR-20261103-sync-strategy.md) | Outbox, triggers, ETag writes, three-way merge | Proposed |
| [ADR-20261103-vtodo-mapping](adr/ADR-20261103-vtodo-mapping.md) | Feature → iCalendar property mapping | Proposed |
