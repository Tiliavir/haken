# ADR-20261104: Sync quarantine per resource

Status: Accepted

Supersedes the rule "an unexpected error in sync stops the whole sync run" in [ADR-20261104-strict-errors](ADR-20261104-strict-errors.md) (*No data loss when throwing*).

## Decision

- An unexpected error while pulling or pushing **one resource** (a task, or one list's changes, contents or properties) quarantines that resource:
  - one error task (deduplicated like every error task);
  - a record in the `state` store: the server state the attempt saw (ETag, sync token, or the raw list properties) and a hash of the local record;
  - its outbox entries and local data stay untouched;
  - the run continues with the other resources.
- A quarantined resource is skipped in later runs until its **server state or its local record changes**; then it is tried again. Success removes the record.
- An error in list discovery for one collection (invalid properties) quarantines that list only: it is neither added, updated nor removed locally.
- **Run-level errors still stop the run:** an unexpected answer to the probe or to the list discovery request, an inconsistent outbox (entry for an unknown list or task), a local store error.
- `PUT` answered `409` with `no-uid-conflict` (RFC 4791 5.3.2.1: another resource in the list has the same `UID`) is its own result and quarantines the task. Any other `409` or a `404` means the collection is gone.
- The sync status shows *n items not synced* while records exist, linked to the errorlogs list.

## Why

- One unreadable answer for one task must not block every other change on every device: with a stopped run, a single bad resource keeps all other edits unsynced indefinitely.
- Retrying only on change avoids an error task (and a request) per run for something that will fail the same way; any change on either side is a new chance.
- Errors that are not about one resource cannot be isolated safely; continuing would act on a state that is known to be wrong.
- A `UID` conflict is a data problem in the list, not a missing collection; treating it as "collection missing" would hide it.
