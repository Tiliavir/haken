# Plan: fixes from the PR #6 review

One agent, steps in order, one commit per step, on this branch (based on
`feat/initial-implementation`). `make check` stays green after every step.

The review was done before recurrence and *Focus* were merged (#7, #8).
Check each finding against the current code first; skip it if it no longer
applies. Items already in `BACKLOG.md`, `OPEN.md` or `decisions.md` are out
of scope unless listed here.

ADRs on `main` are immutable: changed rules get a new ADR, and the old one
only changes its status (`Accepted; partly superseded by …`).

## 1. Error-task content

- New ADR `ADR-20261104-error-task-content`: error tasks may contain task
  values. They stay in the user's own store; the user strips them before
  filing a bug. Credentials, cookies, `Authorization`, session ids and query
  strings stay forbidden.
- Mark `ADR-20261104-strict-errors` partly superseded; adjust the matching
  sentence in `CLAUDE.md`.
- Unit tests for `buildReport`: secret keys dropped, query strings stripped.

## 2. Sync quarantine per resource

- An unexpected error on one resource (pull or push) creates one error task,
  is recorded as quarantine in the `state` store and is skipped; the run
  continues with the rest.
- A quarantined resource is retried when its server ETag or its local
  content changes.
- An error in list discovery quarantines that list only.
- Run-level errors (unexpected probe answer, inconsistent outbox) still stop
  the run.
- `PUT` 409 gets its own result (UID conflict, quarantined) instead of
  "collection missing".
- Sync status shows "n items not synced", linked to errorlogs.
- New ADR `ADR-20261104-sync-quarantine`; mark the strict-errors ADR partly
  superseded.

## 3. Set merge for labels and attachments

- `CATEGORIES` and `ATTACH`: result = (server ∪ added) − removed, where
  added/removed are the local changes against the merge base. No base:
  union. No conflict note for these groups.
- An attachment is identified by its whole property (value and parameters).
- Update D02 in `decisions.md`; add cases to `merge.test.ts`.

## 4. Autosave

- Title, note and checklist item titles save on `input` (debounced) and
  flush on `pagehide` and on `visibilitychange` to hidden.
- Add-task, add-checklist-item and add-label fields clear only after the
  commit succeeded; on failure the text stays.
- E2E: type into the note without blur, reload, text is kept.

## 5. StaleError after a successful PUT

- Retry the post-PUT commit: store ETag and base, keep the newer local edit
  and its outbox entries.
- Covered by the browser unit tests (step 9).

## 6. Conflict and logout UX

- Whole-resource notes (`*`): short text instead of the raw ICS, plus
  *Export (.ics)*.
- Logout *Export pending changes, then delete*: after the download, ask
  whether the file was saved; delete only on confirmation.

## 7. Small fixes

- Proxy: remove `MOVE` and `COPY`; Go test expects `405`.
- Adding from a smart list shows the target list ("Add to ‹list›").
- The due date for smart-list adds is taken at submit time, not render time.

## 8. Naming

- UI name "Steps" becomes Checklist / Checkliste / Liste de contrôle /
  Lista de comprobación / Lista di controllo. Message strings only; keys
  stay. Update chapter 8.
- Remove any mention of the commercial to-do app that inspired the UX from
  the repo (project rule).

## 9. Tests

- Browser unit tests (Playwright, built modules, `fetch` stub acting as a
  minimal CalDAV server): `commit` expectations, abort on throw, 412 loop,
  quarantine, invalid sync token, StaleError retry.
- E2E: `.ics` import/export round trip; attachments add, download, remove;
  `413` via a small `max_content_length` in the E2E Radicale config;
  list-delete race as `test.fixme` pointing to the backlog item.
- Gateway: limiter per key; method allowlist.
- Same Radicale version for dev/E2E (pip) and `deploy/compose.yml`; verify
  the `tomsquest/docker-radicale` tag exists.

## 10. Docs

- Chapter 7: remove the `X-Forwarded-Proto` claim; TLS ends at the DSM
  proxy, the cookie is always `Secure`.
- Chapter 6: the sync run (order, 412 loop, quarantine), a few lines.
- Chapter 9: list the new ADRs.
- `BACKLOG.md`: add "list deleted while another client edits one of its
  tasks: restored task hidden, `deletelist` op never drains" and "check the
  total resource size against the gateway's 32 MiB body limit before
  attaching"; remove items done here.

## 11. Finish

- `make check` green, push, short comment on PR #6 listing the steps.
- Delete this file in the last commit.
