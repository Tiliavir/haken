# ADR-20261103: Authentication and authorization

Status: Accepted

## Decision

- **Radicale is the only authority** for users and passwords (its `htpasswd`, bcrypt). The gateway has no user store.
- **Other CalDAV clients** (DAVx⁵, Thunderbird): the gateway passes their Basic auth through unchanged.
- **haken PWA:** `POST /api/session` sends credentials once; the gateway verifies them with a `PROPFIND` to Radicale. On success it keeps them in memory only and sets an `HttpOnly; Secure; SameSite=Strict` session cookie. Proxied requests get Basic auth injected from that session.
- Sessions expire after inactivity and on gateway restart. An expired session pauses sync only; the outbox waits until the next login.
- **Authorization:** Radicale `rights = owner_only`. The gateway additionally allows only `/dav/<session user>/…` (defence in depth).
- **Local data is per account:** one IndexedDB database per server + user. Another user on the same device never sees or syncs it.
- **Logout:**
  1. Try a final sync.
  2. Outbox empty: delete the server session (if reachable) and the local database.
  3. Outbox not empty (offline or sync failed): ask. Options:
     - Cancel (default).
     - Log out, keep data on this device: the outbox resumes at the next login of the same user.
     - Export pending changes as `.ics`, then delete.
     - Discard: only after typing the number of changes lost.
  4. Offline: the server session is not reachable; it ends by inactivity timeout.

## Why

- Logout must never be a hidden delete of unsynced work.

- One place for credentials; nothing to keep in sync.
- The browser never stores a password or token readable by scripts.
- Offline use never depends on a valid session.
