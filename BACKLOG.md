# Backlog

Work that is not done yet, to plan. Undecided questions are in
[`OPEN.md`](OPEN.md); decisions to review in [`decisions.md`](decisions.md).

## Blocked by an open question

| Item | Blocked by |
| --- | --- |
| Reminders (`VALARM`): show, edit, fire | `OPEN.md` Reminders |
| Gateway hardening: rate limit for Basic-auth paths, `/.well-known/caldav`, principal discovery paths, TLS end, `X-Forwarded-*` | `OPEN.md` Gateway security |
| Final sort-order semantics and fixtures | `OPEN.md` Sort order |

## Interoperability

- Replace the synthetic fixtures with anonymised real exports from Tasks.org (via DAVx⁵), Thunderbird and Apple Reminders; add a round-trip test per client version.
- Verify against Tasks.org that it keeps haken's `ATTACH` and `X-APPLE-SORT-ORDER` when it writes (ADR mapping, "covered by interop tests").
- Repeating tasks, next steps: *repeat after completion* (after `OPEN.md`), end after N times or on a date (`COUNT`/`UNTIL`), monthly by weekday ("second Tuesday"), editing `RECURRENCE-ID` overrides if ever needed.
- Verify with a real Tasks.org export that it reads haken's advanced `DUE`/`DTSTART` the same way, especially for weekly rules with weekdays.
- CalDAV discovery (`/.well-known/caldav`, `current-user-principal`, `calendar-home-set`) instead of the fixed `/dav/<user>/` (D14).
- Relax or confirm the `TZID` without `VTIMEZONE` rule once error tasks show real-world data (D11).

## Sync and store

- Browser-run unit tests for `store/` (record validation, `commit` expectations, abort on throw) and `sync/` with a mocked `net/` (412 loops, `StaleError` retries, invalid-token fallback). Today these paths are covered by E2E only.
- `413`: stop retrying every run; retry after the task changed (D23).
- Storage quota: warn when `navigator.storage.estimate()` is near the limit (ADR strict errors lists quota warnings as expected states).
- Move a task to another list (new href, delete + create with the same UID, conditional on both sides).
- Promote a step to a task and back.
- Snapshot performance: every change re-parses every VTODO; cache views by resource text.
- Schema migration path (`schema: 2`) with a backup, as required by CLAUDE.md, before the first change to a record shape.
- Multi-tab: E2E with two tabs of the same account (Web Locks, BroadcastChannel).

## UI

- Design the screens chapter 8 lists as *Not designed yet* (setup, empty list, offline, conflict note and notice, logout confirmation); the current versions follow chapter 8 but are not designed. Update the sketches.
- Today: drag onto *Today* on mobile (e.g. a long-press menu), manual order inside *Today* (D57, D59).
- Due time of day (time picker), reminder field (after `OPEN.md`).
- List colour and list order (read from `calendar-color` / `calendar-order`, not editable yet); reorder lists by drag and drop.
- Accessibility pass: announce drag-and-drop moves in a live region, focus management after deleting a task, screen-reader test.
- Hidden user-name field in the *Sign in to sync* dialog so password managers fill it.
- Trusted Types (`require-trusted-types-for 'script'`) with a single policy for the service-worker URL (D34).
- Offer a `de-CH` locale (D42).

## Quality gates and delivery

- `make check` in pinned containers as the ADR says; today `make check` runs on the host and only CI uses a container.
- Verify the pinned versions in CI and compose: Playwright image `v1.63.0-noble`, `staticcheck 2025.1.1`, `tomsquest/docker-radicale` tag. Pin images by digest.
- E2E for import/export, attachments (add, download, 5 MB limit), theme and accent, language switch, setup on WebKit (Safari behaviour), install flow.
- Coverage report for unit tests (`node --test --experimental-test-coverage`).
- Type-check the E2E sources with `tsc` (today Playwright transpiles them without type checking).
- Release process: version number in `app/errors.ts` `APP_VERSION` from the build, changelog, container tags.
