# ADR-20261105: Reminders fire only while haken is open

Status: Accepted (implementation tracked in a GitHub issue)

## Decision

- haken shows and edits reminders as `VALARM` and fires them only while it is open (a notification or an in-app notice).
- No Web Push, no push server. Other clients on the same server (Tasks.org via DAVx⁵, Thunderbird) fire the same `VALARM`s when haken is closed.

## Why

- A closed web page cannot wake up. Web Push would need state in the gateway and requests to the browser vendors' push services, which the no-leak rule forbids.
