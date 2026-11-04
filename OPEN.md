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


## Sort order semantics (`X-APPLE-SORT-ORDER`)

Implemented provisionally ([D06, D07](decisions.md)): ascending; a missing
value defaults to seconds from 2001-01-01 to `CREATED`; new tasks on top.
To decide after checking Tasks.org's source and a real export:

- Is the default for a missing value the same in Tasks.org (else a task
  jumps when haken first writes an order)?
- New tasks on top or at the bottom? Whatever Tasks.org does, haken should
  match, or the two apps show different orders for the same list.

## Strictness for other clients' data

`TZID` without a matching `VTIMEZONE` turns real-world data into *Cannot be
read* tasks ([D11](decisions.md)). Keep it strict and learn from error
tasks, or accept IANA time-zone names via `Intl`?

(Recurrence overrides were decided: they stay unreadable,
[ADR-20261104-recurrence](docs/arc42/adr/ADR-20261104-recurrence.md).)

## Repeat after completion

Not implemented ([recurrence ADR](docs/arc42/adr/ADR-20261104-recurrence.md)).
Tasks.org supports it; how it encodes the choice in the `VTODO` has to be
checked before haken writes or reads it.

## Local account outbox

The browser-only ADR says the outbox of a local account is "never drained".
The implementation writes no outbox entries at all for local accounts
([D15](decisions.md)). Reword the ADR, or keep an outbox for a reason not
seen yet?

## Session lifetime

Implemented: 7 days idle ([D26](decisions.md)); the password stays in
gateway memory that long. Alternatives: shorter idle plus an absolute limit,
or a per-device token Radicale never sees. Part of *Gateway security*?
