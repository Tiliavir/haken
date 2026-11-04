# Decisions to review

Taken during the first implementation (branch `feat/initial-implementation`).
None of them is in an ADR yet. Accept, change or reject each; accepted ones
move into the ADRs and chapters they touch, then this file shrinks.

**Review** marks decisions that change or stretch an accepted ADR or that
carry real risk. Questions that still need an answer are in
[`OPEN.md`](OPEN.md); work that is not done yet is in [`BACKLOG.md`](BACKLOG.md).

## Data and iCalendar

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D01 | Round-trip fidelity is checked **semantically**: every property, parameter, value type and value per component. Not line by line. | ical.js re-orders parameters and drops `VALUE=URI` where it is the default. The meaning is unchanged; a text diff would fail on every resource. | `tests/unit/helpers.ts` `canonical()` |
| D02 | Merge and outbox work on **property groups**. `COMPLETION` = `STATUS` + `COMPLETED` + `PERCENT-COMPLETE`; each subcomponent type (`VALARM`) is one group; every other property is its own group. `UID`, `DTSTAMP`, `LAST-MODIFIED`, `SEQUENCE` are never merged. | Merging `STATUS` and `PERCENT-COMPLETE` independently can produce "completed, 40 %". Alarms are only meaningful as a whole. | `domain/vtodo.ts` `GROUPS` |
| D03 | The merge result is built **on the server version**; only groups the local side wins are written over it. On a local win `SEQUENCE` = max of both, `LAST-MODIFIED` = max of both. | Keeps VTIMEZONEs and properties other clients added, without having to know them. | `domain/merge.ts` |
| D04 | **No merge base** (a create raced with the same UID): every differing group is decided by time. | There is no common ancestor to tell who changed what. | `domain/merge.ts` |
| D05 | If nothing local survives a merge, the outbox entries for that task are **dropped**, no PUT. | A PUT of the server's own content would change its ETag and make DAVx⁵ re-download: ping-pong. | `sync/runner.ts` `applyRemote` |
| D06 | **Review.** `X-APPLE-SORT-ORDER`: ascending integer. Absent → seconds from 2001-01-01 to `CREATED` (else `DTSTAMP`). | This is the Nextcloud Tasks convention (Apple reference date). Not verified against Tasks.org's code; see `OPEN.md`. | `domain/vtodo.ts` `readTask` |
| D07 | New tasks go **on top** (min − 1), new steps **at the end** (max + 1). A move writes only the moved task; without an integer gap it shifts the following tasks by the minimum needed. | Same as the familiar list apps; minimal writes avoid ordering fights between clients. | `domain/order.ts` |
| D08 | Written as plain `X-APPLE-SORT-ORDER:<n>`, no `VALUE=INTEGER`. | Other clients write it that way. | `domain/vtodo.ts` |
| D09 | ~~Repeating tasks read-only.~~ Superseded by [ADR-20261104-recurrence](docs/arc42/adr/ADR-20261104-recurrence.md). | Decided 2026-11-04. | — |
| D10 | `STATUS:CANCELLED` counts as done (shown under *Completed*). Un-completing writes `NEEDS-ACTION`. | haken has no "cancelled" state; hiding such tasks would be worse. | `domain/vtodo.ts` |
| D11 | **Review.** `DATE-TIME` with `TZID` but no matching `VTIMEZONE` is invalid input. | RFC 5545 requires the VTIMEZONE; per the strict-input rule this is an error, not a guess. Some clients may rely on IANA names; we would learn it from error tasks. | `domain/vtodo.ts` |
| D12 | The UI sets dates only (`DUE;VALUE=DATE`). `DATE-TIME` values from others are read and shown; if haken writes one it is UTC. | Matches the current design (no time picker). | `ui/screens/task.ts` |
| D13 | Only `http(s)` URI attachments are links; any other scheme is shown as text. | A `javascript:` URI from another client would otherwise be clickable. | `ui/screens/task.ts` |
| D14 | Hrefs: list `/dav/<user>/<uuid>/`, task `<list><uid>.ics`. Imported UIDs with characters outside `[A-Za-z0-9._-]` get a UUID file name. Calendar home is `/dav/<user>/` (Radicale's layout), no principal discovery. | Simple and stable; discovery is in the backlog. | `sync/runner.ts` `homeOf`, `app/service.ts` |

## Local store and sync

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D15 | **Review.** Local accounts write **no outbox entries**. The [browser-only ADR](docs/arc42/adr/ADR-20261103-browser-only-mode.md) says "the outbox is never drained". | An outbox that is never drained only grows and would show a meaningless pending count. Nothing reads it for local accounts. The ADR should be reworded if accepted. | `app/service.ts` (`isServer` checks) |
| D16 | Account database `haken-account-<id>`; server id = `server-` + 64-bit FNV hash of `origin|user`, local id = `local-<uuid>`. Stores: `lists`, `tasks`, `base`, `outbox`, `conflicts`, `state`. Every record has `schema: 1` and is validated on read. | One database per server + user (Auth ADR); the hash keeps user names out of database names. | `store/` |
| D17 | Every transaction uses `durability: "strict"`. | "Saved" must mean on disk. | `store/idb.ts` |
| D18 | `commit()` takes **expectations** (task text, outbox ids). If the user edited a task while sync was computing, the commit fails with `StaleError` and sync recomputes (up to 3 times). | Prevents sync from overwriting an edit made during a network round-trip. | `store/account.ts` |
| D19 | Sync run order: list ops (MKCALENDAR, PROPPATCH) → list discovery → pull every list → push task ops → list deletes. Pulled changes are merged **immediately** when local edits are pending, not only after a 412. | One code path for both cases; the push then carries the merged result. | `sync/runner.ts` |
| D20 | A `412` on push: `GET`, merge, retry; at most 3 attempts per run, then an error. | Bounded; a persistent race is an unexpected situation. | `sync/runner.ts` |
| D21 | **Review.** Deleting a list: delete each task with `If-Match`, then `DELETE` the collection **only if it is empty**; if another client added tasks meanwhile, the list is kept and a notice says so. A list deleted on the server while haken has pending edits in it is **re-created** with those tasks. | Never delete what haken has not seen; never drop local edits. | `sync/runner.ts` |
| D22 | `502`/`503`/`504` from the gateway count as *unreachable* (Radicale down), like a network error. | It is not a haken bug; an error task per sync attempt would be noise. | `net/http.ts` |
| D23 | `413` sets a per-task flag; the change stays in the outbox and the task shows the error. The push is retried every run. | ADR says "keeps the change in the outbox". Retrying forever is in the backlog. | `sync/runner.ts` |
| D24 | Error tasks: fingerprint = FNV-1a 64 of name, message, top stack frame. Context keys that look like secrets or content (`pass`, `auth`, `cookie`, `token`, `session`, `summary`, `description`, `title`, `label`, `categor`, `content`) are dropped; query strings are cut. Writing an error task **does not trigger a sync**. | No crypto needed for dedupe. Without the last rule a failing sync would re-trigger itself every 2 s through its own error task. | `app/errors.ts`, `app/service.ts` |
| D25 | Orphaned steps (`RELATED-TO` to a missing parent) are shown as top-level tasks and reported once per session. | Visible data, one error task, no flood on every refresh. | `app/service.ts` |

## Recurrence (details below the ADR)

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D53 | The next occurrence counts from the **current due date**, not from today. An overdue daily task completed late can still be overdue. | Predictable, and the same rule for every client; "from today" is close to *repeat after completion*, which is not decided. | `domain/recurrence.ts` |
| D54 | Weekly with weekdays and an interval: the next day in the same week, else the first chosen day `interval` weeks later (week starts Monday). Rules with another `WKST` are read-only. | RFC 5545 semantics with DTSTART moving along the series. | `domain/recurrence.ts` |
| D55 | Steps are reopened, not deleted or copied, when the task advances. | The checklist belongs to the task and is needed again next time. | `app/service.ts` |
| D56 | Only top-level tasks get a *Repeat* row; repeating steps written by other clients follow the same rules but have no picker. | Steps are one level and part of their task's occurrence. | `ui/screens/task.ts` |

## Gateway

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D26 | **Review.** Session idle timeout **7 days** (`HAKEN_SESSION_IDLE`). | The PWA is often closed for days; a short timeout means signing in again constantly. The password stays in gateway memory that long. | `cmd/haken/main.go` |
| D27 | Cookie `__Host-haken` (`HttpOnly; Secure; SameSite=Strict; Path=/`). | The `__Host-` prefix makes browsers enforce Secure and no Domain. | `internal/session` |
| D28 | Login rate limit: 5 failures in 15 min, counted per remote address **and** per user name; key is `RemoteAddr` only. | Trusting `X-Forwarded-For` is open (`OPEN.md`). Behind the DSM proxy all clients share one address, so the per-user key does the real work. | `internal/session/limiter.go` |
| D29 | User names: `[A-Za-z0-9._@-]{1,64}`; others are rejected with `400`. | Needs no escaping in paths or Basic auth; makes the path check exact. | `internal/session` |
| D30 | Login check: `PROPFIND /<user>/` with Depth 0; `207` = valid, `401`/`403` = invalid, anything else = `502`. | Proves the password and the collection owner in one request. | `internal/session` |
| D31 | `/dav`: query strings are removed, `Cookie` is never forwarded, `Set-Cookie` from Radicale is removed, body limit 32 MiB, `X-Script-Name: /dav`. Session requests must be same-origin (`Sec-Fetch-Site`/`Origin`). Path restriction: `/dav/<user>` and below only. | Defence in depth; the path rule is the minimal version until gateway security is decided. | `internal/proxy` |
| D32 | Strict JSON on `/api/session`: exact keys, `Content-Type: application/json`, unknown fields → `400` with error id. | Strict input (ADR). | `internal/session` |
| D33 | New package `internal/httpx` (error ids, JSON responses, same-origin check), shared by `session` and `proxy`. | Avoids duplicating the error-id format. Chapter 5 updated. | `gateway/internal/httpx` |
| D34 | CSP `default-src 'none'` with explicit `'self'` for script, style, img, connect, manifest, worker; `form-action 'none'`; `base-uri 'none'`. Same policy as header and `<meta>`. No Trusted Types yet. | Tightest policy that works; Trusted Types needs a policy for the service-worker registration (backlog). | `internal/static`, `web/index.html` |

## UI

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D35 | Hash routes (`#/list/<href>`, `#/smart/today`, `…/task/<href>`, `#/settings`). | Work on any static host, including GitHub Pages; the back button works. | `ui/route.ts` |
| D36 | **Review.** Mobile shows one screen at a time through **one CSS media query** (720 px). Chapter 8 says the panes stack "without breakpoint code"; there is no JS for it, but there is this one CSS rule. | Stacking all panes on a phone would show sidebar, list and task at once. | `web/styles/app.css` |
| D37 | One root-owned `<dialog>` for every modal; text typed in a focused field survives a re-render. | A background sync re-renders the screen; a dialog inside it would vanish, a half-typed title would be reset. | `ui/app-root.ts` |
| D38 | **Review.** Smart lists: *Today* = open, due ≤ today; *Planned* sorted by due date; *All* = every task except errorlogs, completed ones collapsed. Adding from a smart list goes into the first user list; *Important* stars it, *Today*/*Planned* set due today. Smart lists cannot be reordered. | Mirrors the familiar behaviour; manual order belongs to a real list. | `ui/views.ts`, `ui/screens/list.ts` |
| D39 | Steps are one level deep; deleting a task deletes its steps. | Matches the design; nested steps from other clients are kept, not shown. | `app/service.ts` |
| D40 | Overdue dates are bold `--text-2`, no red. | One accent colour (chapter 8). | `web/styles/app.css` |
| D41 | Changing the language reloads the page. | `t()` is resolved at render time from one loaded locale; a reload is the simplest correct switch. | `ui/screens/settings.ts` |
| D42 | `de.json` uses standard German spelling (ß). A Swiss variant would be `de-CH.json`. | Default for "Deutsch". | `web/locales/de.json` |
| D43 | Setup: the account record has `ready`; install and persistent-storage steps run with the account active but not ready. *I installed it* (separate app storage) can only show a hint to open the app. | Resumable setup with one state flag; the install cannot be detected from the tab. | `store/records.ts`, `ui/screens/setup.ts` |
| D44 | Logout *Export pending changes, then delete* exports only tasks with pending changes. | That is what would be lost. | `app/service.ts` |

## Tooling and build

| # | Decision | Why | Where |
| --- | --- | --- | --- |
| D45 | Dev dependencies, pinned: `typescript 7.0.2`, `@biomejs/biome 2.6.4`, `vnu-jar 26.11.3`, `@playwright/test 1.63.0`. Node 22, Go 1.24. | The tools named in the quality-gates ADR; `vnu-jar` and Playwright are the npm distributions. | `package.json` |
| D46 | No `@types/node`: tests use a small own declaration file. | One dependency less; the tests use very little of Node. | `tests/unit/node.d.ts` |
| D47 | `tsc` compiles `web/src` and `tests/unit` to `dist/`; `tools/build.mjs` assembles `dist/web`, moves `sw.js` to the root (scope `./`), writes `shell-manifest.json` and stamps the cache name with a hash of the shell. | No bundler; every change installs a fresh cache. | `tools/build.mjs` |
| D48 | The gateway embeds from `gateway/cmd/haken/dist` (copied by `make gateway`; a placeholder README is committed). | `go:embed` cannot reach parent directories. | `Makefile` |
| D49 | Biome checks code, JSON and CSS only, not Markdown. `useLiteralKeys` off (conflicts with `noPropertyAccessFromIndexSignature`), `noImportantStyles` and `noDescendingSpecificity` off. | Biome reformatted the docs; the two CSS rules flag intentional overrides of base input styles. | `biome.json` |
| D50 | E2E runs against the real gateway and Radicale 3.9.0 from pip with plain-text `htpasswd` (dev only). Locally Playwright uses the installed Chrome; CI uses the official Playwright image (`PLAYWRIGHT_CHANNEL=chromium`). | Same tests locally and in CI without downloading browsers here. | `playwright.config.ts`, `tools/dev-run.sh` |
| D51 | CI: one job in the Playwright container + Go + Java + Radicale, then `staticcheck`; a Pages job deploys the demo build after `check` on `main`. | ADR: same gates locally and in CI. Image and tool versions still need a check, see backlog. | `.github/workflows/ci.yml` |
| D52 | Container: multi-stage build to a `scratch` image running as user 65534. | One static binary, nothing else (chapter 7). | `deploy/Dockerfile` |
