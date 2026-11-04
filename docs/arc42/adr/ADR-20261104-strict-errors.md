# ADR-20261104: Strict error handling and the "errorlogs" list

Status: Accepted; partly superseded by [ADR-20261104-error-task-content](ADR-20261104-error-task-content.md)

## Decision

### Fail fast

- Unexpected behaviour throws. No silent fallbacks, no `catch` that only logs, no defaults that hide a broken invariant.
- Code checks its assumptions with `assert(condition, message, context)` from `domain/`; it throws a typed `HakenError`.
- **Expected** situations are states, not errors, and are handled where they occur: offline, `401`, `412`, `404` on delete, `413`, quota warnings, user input validation.
- **Unexpected** examples: a violated invariant, a server response with an undocumented status or shape, an IndexedDB error, an unparseable `VTODO`, an unknown outbox operation, an uncaught exception or rejected promise.

### Strict input

Every input is validated against an explicit expectation at the boundary where it enters. Anything outside that expectation is an unexpected error, not something to guess around.

| Input | Expected | Unexpected (→ error task) |
| --- | --- | --- |
| CalDAV responses | Documented status codes, well-formed XML with the requested properties | Any other status, missing or malformed properties, wrong content type |
| `VTODO` from the server or an import | Valid RFC 5545; unknown `X-` and IANA properties (preserved untouched) | Invalid syntax; an invalid value in a property haken interprets (e.g. `PRIORITY:12`, unknown `STATUS`, malformed `DUE`, `RELATED-TO` to a missing parent) |
| `/api` responses | Exact JSON shape per endpoint | Missing, extra or wrongly typed fields |
| `config.json`, locale files | Exact schema, no unknown keys | Anything else; the app does not start with an invalid `config.json` |
| IndexedDB records, outbox operations | Current schema version and shape, checked on read | Anything else |
| Gateway requests | Exact JSON shape, known paths and methods | Rejected with `400`/`405` and logged with an error id |
| User input in forms | Validated in the form, message at the field | — (this is expected, not an error) |

- Unknown properties are expected: CalDAV clients add them and haken must preserve them. Strictness applies to what haken reads and interprets, never by dropping what it does not understand.
- An invalid `VTODO` is stored as raw text, shown as a read-only task marked *Cannot be read* and never written back by haken. One error task per fingerprint records the property, the value and the client (`PRODID`).
- An import with invalid items still shows them to the user ([browser-only mode](ADR-20261103-browser-only-mode.md)) and also creates an error task.
- Parsing and validation are pure functions in `domain/` (or `net/` for transport shapes), each with tests for accepted and rejected input.

### No data loss when throwing

- An exception aborts the current operation only. The IndexedDB transaction rolls back; the edit and its outbox entry are either both written or neither.
- An unexpected error in sync stops the whole sync run. The outbox is left untouched and the next trigger retries. The sync status shows *Sync error* until a run succeeds.
- An unparseable server resource is kept as raw text and never deleted or overwritten.

### Error tasks

- Every unexpected error creates a task in a list named **errorlogs** (not translated) in the active account. The list is created on the first error, on the server like any other list, or locally in a local account.
- Global handlers (`error`, `unhandledrejection`) and the sync runner route errors to `app/errors.ts`. The service worker reports its errors to the page by `postMessage`.
- The task is as precise as possible:

  | Field | Content |
  | --- | --- |
  | `SUMMARY` | `<error name>: <message>`, cut at 120 characters |
  | `DESCRIPTION` | Plain text: message, stack trace (real file paths and lines, there is no bundler), operation (e.g. `sync.push`), layer, app version and build, time (UTC), user agent, online state, account type, outbox length, involved `UID`s and collection paths, HTTP method, path and status, gateway error id |
  | `CATEGORIES` | `error`, plus the layer (`sync`, `store`, `net`, …) |
  | `X-HAKEN-ERROR-FINGERPRINT` | Hash of error name, message and top stack frame |

- **Never in an error task:** passwords, cookies, `Authorization` headers, session ids, query strings, task titles, descriptions, labels or attachment content. Tasks are referenced by `UID` only.
- **No flooding:** an open error task with the same fingerprint is updated instead (occurrence count, last seen). At most 20 new error tasks per day per device.
- **No recursion:** an error while writing an error task goes to `console.error` and is counted in the meta database; it never creates another task.
- The errorlogs list is excluded from the smart lists and their counts.

### Gateway

- The gateway logs unexpected errors to stdout with an error id (no credentials, no request bodies) and returns `500` with `{"errorId": "…"}`. The client puts that id into its error task, so both sides can be matched.

## Why

- An error that is swallowed shows up later as lost or corrupted data. Stopping at the first broken assumption keeps the damage small and the cause close to the symptom.
- Lenient parsing hides differences between clients until they turn into wrong data. Rejecting unexpected input at the boundary shows each difference once, precisely, so the parser can be fixed deliberately ("we learn and fix").
- haken has no telemetry and sends nothing to third parties. The user's own CalDAV server is the only place an error can be stored, and a task there is visible on every device and in other clients.
- Error tasks sync to the server and may be copied into an issue, so they must hold only technical context, never credentials or task content.
