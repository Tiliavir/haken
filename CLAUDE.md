# CLAUDE.md

Guidance for Claude (and other coding agents) working in this repository.

## What this is

**haken** is a to-do web app, delivered as an installable PWA, that uses a
CalDAV server (primarily Radicale) as its single source of truth. It must work
offline and sync back when a connection is available. UX and feature set are
modelled on mainstream list-based to-do apps (lists, My Day, steps, drag-and-
drop ordering), but the design, code, names, icons and assets must be
original.

## Non-negotiables

These outrank every other consideration, including feature velocity.

1. **No data loss.**
   - Never overwrite a server resource blindly. Every write uses
     `If-Match` with the last known ETag (or `If-None-Match: *` on create).
   - On `412 Precondition Failed`, fetch the server version and merge it
     as defined in `ADR-20261103-sync-strategy`: per property, the newer
     edit wins and the losing value is kept as a conflict note on the task.
     No conflict dialog. Never drop either side silently.
   - Local edits are persisted (IndexedDB) *before* the UI reports success
     and before any network attempt.
   - Preserve unknown iCalendar properties and parameters on round-trip.
     Other clients (DAVx⁵, Tasks.org, Thunderbird) put data there; we must
     write it back untouched.
   - Deletes are soft locally until the server confirms them.
   - Any migration of local storage must be reversible or backed up first.
2. **No data leaks.**
   - The app talks only to the CalDAV server the user configured. No
     analytics, telemetry, third-party fonts, CDNs or external requests of
     any kind at runtime.
   - Credentials are never logged, never put in URLs, and never stored in
     plain `localStorage`.
   - Strict Content-Security-Policy; no `eval`, no inline scripts.
   - Never commit real server URLs, usernames, passwords or task data —
     including in tests, fixtures, screenshots and issue text.
3. **Interoperability.** Data written by haken must remain valid, readable
   `VTODO`s for other CalDAV clients. Prefer standard properties (RFC 5545,
   RFC 9253 for relations, `CATEGORIES` for labels, `ATTACH` for
   attachments) over custom `X-` properties; use `X-` only where no standard
   exists (e.g. manual sort order — check what DAVx⁵/Tasks.org already use
   before inventing one).

## Sync modes

- **Direct:** haken speaks CalDAV to Radicale itself.
- **Alongside DAVx⁵:** a web page cannot read DAVx⁵'s local data, so haken
  always syncs itself (see `ADR-20261103-own-caldav-sync`). DAVx⁵ may sync
  the same server for other apps; haken must cope with their changes without
  fighting them (no ordering ping-pong, no duplicate UIDs).

## Repository status

Greenfield. Architecture lives in [`docs/arc42/`](docs/arc42/README.md);
stack and decisions are ADRs there. When build tooling exists,
document commands (build, test, lint, run locally) here and keep this file
current.

## Architecture docs

- arc42, one `.md` per chapter. Add a chapter only when it is needed.
- Short, precise, unambiguous. No filler.
- Every architecture decision is an ADR in `docs/arc42/adr/`, named
  `ADR-YYYYMMDD-short-title.md`: what was decided and why. List it in
  `09-architecture-decisions.md`.
- Update the affected chapters and ADRs in the same change as the code.
- UI rules, screens and design tokens: [`08-crosscutting-concepts.md`](docs/arc42/08-crosscutting-concepts.md).
  Follow it for every UI change; update it when the design changes.
- Questions still waiting for a decision live in [`OPEN.md`](OPEN.md).
  Do not implement anything listed there before it is decided.

## Working conventions

- Keep dependencies minimal and justify each one; prefer the platform
  (Service Worker, IndexedDB, Web Crypto) over libraries.
- Tests are required for anything touching sync, conflict handling,
  iCalendar parsing/serialisation or local persistence. Round-trip tests
  with real-world `VTODO` samples from other clients are especially valuable.
- Be strict: unexpected behaviour throws, never a silent fallback. Every
  unexpected error becomes a precise task in the list "errorlogs"
  (`ADR-20261104-strict-errors`): enough context to analyse and fix it,
  never credentials or task content. Throwing must never lose data.
- Be strict with input too: validate every input against an explicit
  expectation where it enters; unexpected input is an error, never guessed
  around. Unknown iCalendar properties are expected and preserved; invalid
  values in properties haken interprets are errors.
- Small, focused commits with descriptive messages.
- The repo is private now and will become public: write everything
  (code, comments, commit messages, docs) as if it were public already.
