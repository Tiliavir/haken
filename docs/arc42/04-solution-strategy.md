# 4. Solution Strategy

| Goal | Approach | ADR |
| --- | --- | --- |
| Offline for days | Local-first: UI reads/writes the local store only; sync runs separately | [Local store](adr/ADR-20261103-indexeddb-local-store.md), [Sync](adr/ADR-20261103-sync-strategy.md) |
| No data loss | Outbox + ETag-conditional writes + three-way merge | [Sync](adr/ADR-20261103-sync-strategy.md) |
| No data leak, no CORS | Same-origin Go gateway; HttpOnly session cookie | [Gateway](adr/ADR-20261103-go-stdlib-gateway.md) |
| Simplicity | TypeScript + platform APIs, no framework, no bundler; `ical.js` only runtime dependency | [Frontend](adr/ADR-20261103-vanilla-typescript-frontend.md) |
| Interoperability | Standard `VTODO` properties; `X-APPLE-SORT-ORDER` for order | [Data mapping](adr/ADR-20261103-vtodo-mapping.md) |
| One sync path | haken syncs CalDAV itself; DAVx⁵ only for other apps | [Own sync](adr/ADR-20261103-own-caldav-sync.md) |
