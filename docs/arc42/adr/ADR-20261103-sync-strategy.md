# ADR-20261103: Sync strategy

Status: Accepted

## Decision

- **Offline is the normal state.** The UI reads and writes IndexedDB only; it never waits for the network.
- **Outbox.** Each edit appends an operation to the outbox in the same transaction as the task change. The operation records the changed properties and the edit time (UTC).
- **Triggers:** app start, `online` event, app becomes visible, 2 s after the last edit, every 5 min while visible. No background sync (not supported on iOS/Firefox).
- **Reachability probe:** each trigger first sends `GET /api/session` (same origin, HTTPS). The result sets the sync state:

  | Response | State | Sync status |
  | --- | --- | --- |
  | `200` with the expected JSON (`{"user": "<account user>"}`) | Online | *Synced* / *n changes pending* |
  | `401` | Backend reachable, session expired | *Sign in to sync* (opens sign-in) |
  | Network error, timeout, any other status or body | Backend unreachable | *Offline* |

  While unreachable, the probe repeats every 30 s while the app is visible.
- **Pull:** `sync-collection` REPORT (RFC 6578) with a stored token; fallback to ETag comparison via `PROPFIND`.
- **Push:** `PUT` with `If-None-Match: *` (create) or `If-Match: <etag>` (update, delete). Never unconditional.
- **Conflict (412):** three-way merge per property against the last server version kept locally.
  - Property changed on one side only: that change is taken.
  - Same property changed on both sides: the newer edit wins. Local time = the outbox operation's edit time. Server time = the component's `LAST-MODIFIED`, else `DTSTAMP`; neither present: the server wins.
  - The losing value is kept as a **conflict note**: stored locally with the task (not synced), shown in the task detail with *Use this value* and *Dismiss*. It stays until the user picks one of them; nothing removes it automatically. *Use this value* is an ordinary edit through the outbox.
  - If the app is visible, a non-blocking notice names the task. No dialog.
  - Delete against a changed server version: the change wins, the task is restored locally, and a notice says so. A deleted server resource (`404`) against a local edit: the edit is re-created with `If-None-Match: *`.
- **Time:** all comparisons are on UTC instants. Device and server clocks are assumed to be in sync. `DATE-TIME` values with `TZID` are resolved via their `VTIMEZONE`; floating times and `DATE` values are read in the device's time zone. haken writes `LAST-MODIFIED` and `DTSTAMP` in UTC on every change.
- **One syncer:** Web Locks API; other tabs refresh via `BroadcastChannel`.
- **Visibility:** pending-change count and last successful sync always shown; warning after 3 days unsynced.

## Why

- Days offline must lose nothing: the outbox is durable and replays in order.
- ETag preconditions make concurrent edits from other clients detectable instead of silently overwritten.
- `LAST-MODIFIED` (RFC 5545) is the only standard modification time and exists per component, not per property; the outbox supplies the per-property local time.
- Keeping the losing value as a note means no merge decision can destroy data, so no dialog has to interrupt the user.
- The probe is one same-origin request: TLS authenticates the server, and a captive portal or proxy page cannot return the expected JSON for the signed-in user. It also tells "unreachable" apart from "session expired", which needs a sign-in because the gateway keeps credentials in memory only ([Auth](ADR-20261103-authentication.md)).
- Timer and event triggers are standard everywhere; background sync is not.
