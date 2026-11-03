# ADR-20261103: Backend is one Go binary, stdlib only

Status: Accepted

## Decision

A Go gateway, standard library only, does exactly four things:

1. Serves the static app (`embed.FS`) with strict security headers (CSP).
2. Login: checks credentials against Radicale, issues an `HttpOnly; Secure; SameSite=Strict` session cookie.
3. Proxies `/dav/*` to Radicale (`httputil.ReverseProxy`), restricted to the user's own collections.
4. Rate-limits login.

No database, no business logic. Radicale is the only state.

## Why

- Same origin for app and CalDAV: no CORS, credentials never reach browser storage.
- Go's `net/http`, `crypto/tls` and `httputil` are stable and cover all needs: zero third-party modules, one static binary, ~10 MB RAM.
- Zig rejected for now: pre-1.0, `std.http` changes between releases. Revisit when Zig is 1.0.
