# ADR-20261105: Gateway security

Status: Accepted (implementation tracked in a GitHub issue)

## Decision

- `/dav` serves only the haken app: it accepts the session cookie and refuses Basic auth. Supersedes the Basic-auth passthrough in [authentication](ADR-20261103-authentication.md).
- Other CalDAV clients (DAVx⁵, Thunderbird) talk to Radicale directly, on its own host name behind the reverse proxy, with TLS and a fail2ban rule for failed logins.
- TLS ends at the reverse proxy. The gateway trusts no `X-Forwarded-*` header; the login limit keys on the client address and the user name.
- `/dav/<user>` and below is the only proxied path.
- Sessions end after 7 days without use (`HAKEN_SESSION_IDLE`). Then the app keeps working offline, queues edits and shows *Sign in to sync*; after signing in everything syncs.

## Why

- One authentication path per entry point: the gateway handles only sessions, Radicale only Basic auth. No Basic-auth rate limiting is needed in the gateway.
- Daily use never asks for the password again; an unused device is signed out within a week.
