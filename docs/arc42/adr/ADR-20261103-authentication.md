# ADR-20261103: Authentication and authorization

Status: Proposed

## Decision

- **Radicale is the only authority** for users and passwords (its `htpasswd`, bcrypt). The gateway has no user store.
- **Other CalDAV clients** (DAVx⁵, Thunderbird): the gateway passes their Basic auth through unchanged.
- **haken PWA:** `POST /api/session` sends credentials once; the gateway verifies them with a `PROPFIND` to Radicale. On success it keeps them in memory only and sets an `HttpOnly; Secure; SameSite=Strict` session cookie. Proxied requests get Basic auth injected from that session.
- Sessions expire after inactivity and on gateway restart. An expired session pauses sync only; the outbox waits until the next login.
- **Authorization:** Radicale `rights = owner_only`. The gateway additionally allows only `/dav/<session user>/…` (defence in depth).
- Logout deletes the session and the local database.

## Why

- One place for credentials; nothing to keep in sync.
- The browser never stores a password or token readable by scripts.
- Offline use never depends on a valid session.
