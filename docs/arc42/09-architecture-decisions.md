# 9. Architecture Decisions

One file per decision in [`adr/`](adr/), named `ADR-YYYYMMDD-short-title.md`.
Status: `Proposed` → `Accepted` | `Rejected` | `Superseded by …`.

| ADR | Decision | Status |
| --- | --- | --- |
| [ADR-20261103-own-caldav-sync](adr/ADR-20261103-own-caldav-sync.md) | haken syncs via CalDAV itself, not via DAVx⁵ | Accepted |
| [ADR-20261103-go-stdlib-gateway](adr/ADR-20261103-go-stdlib-gateway.md) | Backend: one Go binary, stdlib only | Accepted |
| [ADR-20261103-vanilla-typescript-frontend](adr/ADR-20261103-vanilla-typescript-frontend.md) | Frontend: TypeScript, Custom Elements, no framework, no bundler | Accepted |
| [ADR-20261103-indexeddb-local-store](adr/ADR-20261103-indexeddb-local-store.md) | Local store: IndexedDB, not `localStorage` | Accepted |
| [ADR-20261103-sync-strategy](adr/ADR-20261103-sync-strategy.md) | Outbox, triggers, ETag writes, three-way merge | Accepted; partly superseded by set-merge |
| [ADR-20261103-vtodo-mapping](adr/ADR-20261103-vtodo-mapping.md) | Feature → iCalendar property mapping | Accepted; partly superseded by recurrence, focus |
| [ADR-20261103-browser-only-mode](adr/ADR-20261103-browser-only-mode.md) | Local account without any server | Accepted; partly superseded by implementation-baseline |
| [ADR-20261103-authentication](adr/ADR-20261103-authentication.md) | Radicale authenticates; gateway session for the PWA | Accepted; partly superseded by gateway-security |
| [ADR-20261103-build-time-quality-gates](adr/ADR-20261103-build-time-quality-gates.md) | Validation, lint, tests, architecture rules in containers | Accepted |
| [ADR-20261103-first-start-setup](adr/ADR-20261103-first-start-setup.md) | First start: explicit, resumable setup; install first where app storage is separate | Accepted |
| [ADR-20261103-i18n-json-messages](adr/ADR-20261103-i18n-json-messages.md) | i18n: flat JSON per locale, `Intl`, typed keys; en/de/fr/es/it bundled | Accepted |
| [ADR-20261103-theming](adr/ADR-20261103-theming.md) | `light-dark()` tokens, appearance override, contrast-safe custom accent | Accepted |
| [ADR-20261104-strict-errors](adr/ADR-20261104-strict-errors.md) | Fail fast, strict input validation; unexpected errors become tasks in the list "errorlogs" | Accepted; partly superseded by error-task-content, sync-quarantine |
| [ADR-20261104-focus](adr/ADR-20261104-focus.md) | *Focus*: due/overdue first, then tasks put on Focus; no daily reset; overdue red | Accepted; partly superseded by row-drag |
| [ADR-20261104-recurrence](adr/ADR-20261104-recurrence.md) | Repeating tasks: completing advances the same task; editable `RRULE` subset; overrides stay unreadable | Accepted; partly superseded by rule-locked-edits |
| [ADR-20261104-error-task-content](adr/ADR-20261104-error-task-content.md) | Error tasks may contain task values; never credentials or query strings | Accepted |
| [ADR-20261104-sync-quarantine](adr/ADR-20261104-sync-quarantine.md) | A failing resource is quarantined; the sync run continues | Accepted |
| [ADR-20261104-set-merge](adr/ADR-20261104-set-merge.md) | Labels and attachments merge as sets, without conflict note | Accepted |
| [ADR-20261105-implementation-baseline](adr/ADR-20261105-implementation-baseline.md) | Reviewed implementation decisions of the first version; local accounts have no outbox | Accepted; partly superseded by ci-image, release-from-main, due-time |
| [ADR-20261105-gateway-security](adr/ADR-20261105-gateway-security.md) | `/dav` only for the app (cookie); other clients reach Radicale directly; 7-day idle session | Accepted |
| [ADR-20261105-reminders](adr/ADR-20261105-reminders.md) | Reminders fire only while haken is open; no Web Push | Accepted |
| [ADR-20261105-home-network](adr/ADR-20261105-home-network.md) | Gateway and Radicale only in the home network; no fail2ban | Accepted |
| [ADR-20261105-ci-image](adr/ADR-20261105-ci-image.md) | CI runs in a prebuilt, digest-pinned image; runs download only npm packages | Accepted; partly superseded by ci-browser-per-run |
| [ADR-20261106-ci-browser-per-run](adr/ADR-20261106-ci-browser-per-run.md) | CI installs the locked Playwright browser per run (cached); the image has none | Proposed |
| [ADR-20261106-release-from-main](adr/ADR-20261106-release-from-main.md) | A merge to `main` with an untagged `package.json` version releases it; CI creates the tag | Proposed |
| [ADR-20261106-row-drag](adr/ADR-20261106-row-drag.md) | Drag the whole row (touch: hold); Alt+↑/↓; no long-press row actions | Proposed |
| [ADR-20261107-app-update](adr/ADR-20261107-app-update.md) | A new version is offered with *Reload*, never forced; *What's new* from `CHANGELOG.md` once after an update | Accepted |
| [ADR-20261107-due-time](adr/ADR-20261107-due-time.md) | Optional due time, written as floating `DATE-TIME`; `DTSTART` and `UNTIL` follow its form | Proposed |
| [ADR-20261107-focus-quick-add](adr/ADR-20261107-focus-quick-add.md) | *Quick add* in *Focus*: open tasks not in Focus, due in 7 days first, then important, then by list | Proposed |
| [ADR-20261108-label-views](adr/ADR-20261108-label-views.md) | Labels as views in the sidebar; lists stay collections; drop on a label labels (moves from a label view) | Accepted; partly superseded by label-edit, label-order |
| [ADR-20261108-label-edit](adr/ADR-20261108-label-edit.md) | Rename and delete labels across tasks; *Labels* above the lists | Accepted |
| [ADR-20261108-rule-locked-edits](adr/ADR-20261108-rule-locked-edits.md) | A rule haken cannot edit locks only the rule, completing and due/start; the rest of the task stays editable | Accepted |
| [ADR-20261111-label-order](adr/ADR-20261111-label-order.md) | Labels reordered by dragging; the order stays on the device | Accepted |
| [ADR-20261113-label-emoji](adr/ADR-20261113-label-emoji.md) | An optional emoji per label replaces its icon in the sidebar; kept on the device | Proposed |
