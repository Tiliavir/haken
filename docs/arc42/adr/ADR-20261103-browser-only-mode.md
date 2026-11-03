# ADR-20261103: Browser-only mode without a server

Status: Proposed

## Decision

- A "Local" account works without any backend: data lives in IndexedDB only, the outbox is never drained.
- The same static build runs from any static host (or `localhost`); no gateway required.
- Backup by `.ics` export/import. A local account can later be connected to a CalDAV server; its tasks are uploaded with `If-None-Match: *`.
- The UI shows clearly that local data has no server copy.

## Why

- Local-first already makes the server optional; the mode costs one account type, no new code paths in the store.
- Browser storage can be evicted; export and `navigator.storage.persist()` mitigate, the warning makes the risk explicit.
