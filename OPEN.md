# Open questions

Decisions still to be taken. Nothing here is implemented until it is decided
and recorded as an ADR in [`docs/arc42/adr/`](docs/arc42/adr/).

## Gateway security

Needs its own discussion.

Proposal: the `/dav` proxy serves only the haken PWA. Other CalDAV clients
(DAVx⁵, Thunderbird) talk to Radicale directly.

Consequences to work out:

- Radicale becomes reachable from outside: own host name, TLS, rate limiting
  or fail2ban for Basic auth. Chapter 3 ("Radicale is never exposed") and the
  Basic-auth passthrough in [Auth](docs/arc42/adr/ADR-20261103-authentication.md)
  change.
- The proxy can then refuse Basic auth entirely and accept only the session
  cookie.

Also open:

- Rate limiting for any Basic-auth path; today only `POST /api/session` is limited.
- Path restriction: which paths besides `/dav/<user>/…` must pass (principal
  discovery, `/.well-known/caldav`).
- Where TLS ends: DSM reverse proxy (assumed in
  [chapter 7](docs/arc42/07-deployment-view.md)) or the gateway itself.
- Trusting `X-Forwarded-*` headers only from the reverse proxy.

## Reminders (`VALARM`)

A closed web page cannot wake up at a given time. Web Push would need a push
server holding alarms and subscriptions (state in the gateway) and the
browser vendors' push services (third-party requests). Options:

1. haken shows and edits reminders and preserves `VALARM`; other clients on
   the same server (Tasks.org via DAVx⁵, Thunderbird) fire them.
2. Drop reminders from haken's UI; keep `VALARM` untouched on round-trip.
3. Fire reminders only while haken is open.

## My Day vs. *Today*

*Today* is now "due today or overdue". The mapping still has
`X-HAKEN-MYDAY` for a hand-picked My Day list, but no screen uses it.
Keep it as a separate smart list, or drop it?
