# ADR-20261103: Sync strategy

Status: Proposed

## Decision

- **Offline is the normal state.** The UI reads and writes IndexedDB only; it never waits for the network.
- **Outbox.** Each edit appends an operation to the outbox in the same transaction as the task change.
- **Triggers:** app start, `online` event, app becomes visible, 2 s after the last edit, every 5 min while visible. No background sync (not supported on iOS/Firefox).
- **Pull:** `sync-collection` REPORT (RFC 6578) with a stored token; fallback to ETag comparison via `PROPFIND`.
- **Push:** `PUT` with `If-None-Match: *` (create) or `If-Match: <etag>` (update, delete). Never unconditional.
- **Conflict (412):** three-way merge per property against the last server version kept locally. Same property changed on both sides: newer edit wins, the other value is kept as a visible conflict note.
- **One syncer:** Web Locks API; other tabs refresh via `BroadcastChannel`.
- **Visibility:** pending-change count and last successful sync always shown; warning after 3 days unsynced.

## Why

- Days offline must lose nothing: the outbox is durable and replays in order.
- ETag preconditions make concurrent edits from other clients detectable instead of silently overwritten.
- Timer and event triggers are standard everywhere; background sync is not.
