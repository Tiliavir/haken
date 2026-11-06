# ADR-20261105: Implementation decisions of the first version

Status: Accepted; partly superseded by [ADR-20261105-ci-image](ADR-20261105-ci-image.md), [ADR-20261106-release-from-main](ADR-20261106-release-from-main.md)

Decisions taken while implementing the accepted ADRs, reviewed one by one. Details live in the code named in brackets.

## Decision

### iCalendar

- Round-trip fidelity is checked semantically (every property, parameter, value type and value), not line by line: ical.js reorders parameters (`tests/unit/helpers.ts`).
- Merge and outbox work on property groups: `COMPLETION` = `STATUS` + `COMPLETED` + `PERCENT-COMPLETE`; a subcomponent type (`VALARM`) is one group; every other property is its own. `UID`, `DTSTAMP`, `LAST-MODIFIED`, `SEQUENCE` are never merged.
- The merge result is built on the server version; only groups the local side wins are written over it. Without a merge base (a create raced) every differing group is decided by time. If nothing local survives, no `PUT` is sent.
- Manual order is `X-APPLE-SORT-ORDER`, ascending. A missing value counts as seconds from 2001-01-01 to `CREATED` (else `DTSTAMP`). New tasks go on top (min − 1), new checklist items at the end (max + 1). A move writes only the moved task, plus the fewest following tasks when there is no integer gap. Written without `VALUE=`. This is exactly what Tasks.org does (`ORDER_BY_MANUAL` and `addTasksToTop` in its source); the name comes from Apple Reminders, which introduced it, and is used by Nextcloud Tasks and Tasks.org too. No standard property exists.
- `STATUS:CANCELLED` counts as done.
- `DATE-TIME` with a `TZID` but no matching `VTIMEZONE` is invalid input; haken stays strict.
- haken writes `DUE` as a date; date-times from other clients are read and kept.
- Only `http(s)` URI attachments are links.
- A task is in exactly one list (one CalDAV collection); labels (`CATEGORIES`) are many per task. Paths: list `/dav/<user>/<uuid>/`, task `<list><uid>.ics` (a UUID name for UIDs outside `[A-Za-z0-9._-]`). The calendar home is `/dav/<user>/`; no CalDAV discovery, since haken always runs in front of its own Radicale.

### Local store and sync

- **Local accounts have no outbox.** Supersedes "the outbox is never drained" in [browser-only mode](ADR-20261103-browser-only-mode.md).
- One database per account, `haken-account-<id>` (server: hash of origin and user; local: UUID); every record carries `schema` and is validated on read. Every transaction uses `durability: "strict"`.
- `commit()` takes expectations; an edit that raced a sync computation fails with `StaleError`, and the sync step or command runs again on fresh state (at most 3 times). App commands run one after another.
- Sync order: list operations → list discovery → pull → push → list deletes. Pulled changes are merged at once when local edits are pending. A `412` on push: `GET`, merge, retry, at most 3 times.
- A `401` from `/dav` during a run ends it as *Sign in to sync*: the session can end after the probe at the start, and that is no error of the resource in flight. Nothing is quarantined; every step has committed, so the next run continues.
- A list is quarantined separately for changes (`quarantine:<href>`, the same key form as tasks) and for reading (`quarantine:pull:<href>`). With one key, a successful pull would release a failing `PROPPATCH` every run (one error task per run), and a stuck change would stop the list's pulls.
- Deleting a list deletes its tasks with `If-Match`, then the collection only if it is empty. A list deleted elsewhere while haken has pending edits in it is re-created; a list deleted here keeps existing when one of its tasks comes back (changed elsewhere before its delete) or was added elsewhere.
- An attachment is refused when the whole task would pass the gateway's 32 MiB body limit. A Radicale `max_resource_size` below it answers `412`, not `413`; after 3 attempts the task is quarantined with an error task.
- `502`, `503`, `504` from the gateway mean *unreachable*.
- Writing an error task never triggers a sync. Orphaned checklist items show as top-level tasks.

### Recurrence and Focus

- The next occurrence counts from the current due date. Weekly rules with weekdays: the next chosen day in the week, else the first one `interval` weeks later (week starts Monday).
- Advancing reopens the checklist. Only top-level tasks have a *Repeat* row.
- Completed tasks show in *Focus* only on the day they were completed.

### Gateway

- Cookie `__Host-haken` (`HttpOnly; Secure; SameSite=Strict`). Login: `PROPFIND /<user>/`, 207 valid, 401/403 invalid, else 502; at most 5 failures per 15 min per client address and per user name.
- User names `[A-Za-z0-9._@-]{1,64}`; `/api/session` accepts exact JSON only.
- `/dav`: query strings removed, cookies never forwarded, `Set-Cookie` dropped, body limit 32 MiB, `X-Script-Name: /dav`, same-origin only, `/dav/<user>` and below only.
- CSP `default-src 'none'` with `'self'` per resource type, as header and `<meta>`.
- Trusted Types enforced (`require-trusted-types-for 'script'`). Two policies in `net/trusted.ts`: `haken-sw` allows only `sw.js`; `haken-xml` passes CalDAV responses to `DOMParser` as XML, an inert document that is never inserted. Everything else builds the DOM without HTML strings.

### UI

- Hash routes, so the app runs on any static host.
- Mobile shows one pane at a time by a single CSS media query; no layout code in JS.
- One `<dialog>` owned by the app root; focused text survives a re-render.
- Smart lists: *Planned* by due date; *All* everything but errorlogs; *Important*, *Planned* and *All* cannot be reordered. Adding there goes into the first list.
- The checklist is one level deep; deleting a task deletes its checklist.
- Changing the language reloads the page. Logout export contains only tasks with pending changes. Setup progress is the account's `ready` flag.

### Build

- Dev tools pinned (TypeScript 7, Biome 2, vnu-jar, Playwright); Node 22, Go 1.24. `tools/build.mjs` assembles `dist/web` and stamps the service-worker cache with a hash of the shell. The gateway embeds `gateway/cmd/haken/dist`.
- CI runs `tools/ci.sh` in the Playwright image pinned by digest; `make check-container` runs the same script locally on committed HEAD. Actions are pinned by commit SHA with the version as a comment; Dependabot updates both. Go comes as `GOTOOLCHAIN=go1.24.7`, verified against the Go checksum database.
- `make coverage`: unit tests (LCOV, mapped to the TypeScript sources) and gateway tests (Go profile). E2E coverage is not measured. CI sends both to SonarQube Cloud when the `SONAR_TOKEN` secret is set (`sonar-project.properties`).
- Release: the version lives in `package.json` and is stamped into the app by `tools/build.mjs`. A tag `vx.y.z` runs the full check, then publishes `ghcr.io/tiliavir/haken` (`x.y.z`, `latest`) and a GitHub release with the `CHANGELOG.md` section; tag, `package.json` and changelog must agree (CONTRIBUTING.md).
- E2E runs against the real gateway and Radicale 3.9.0. The container image is `scratch` with one binary, running as user 65534.

## Why

Each decision was the simplest one that keeps the accepted ADRs' guarantees (no data loss, no leak, interoperability). The review is recorded in PR #6.
