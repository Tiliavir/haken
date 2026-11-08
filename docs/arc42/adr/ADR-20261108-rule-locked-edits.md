# ADR-20261108: Editing tasks with a rule haken cannot edit

Status: Accepted

Supersedes, in [repeating tasks](ADR-20261104-recurrence.md), "the task is read-only in haken".

## Decision

- A task whose repeat rule haken cannot edit is **rule-locked**, not read-only.
- Locked: the rule (`RRULE`, `RDATE`, `EXDATE`) and what depends on it: completing (`STATUS`, `COMPLETED`, `PERCENT-COMPLETE`), `DUE` and `DTSTART`. The domain rejects these edits, also as a conflict restore.
- Everything else is editable as on any task: title, note, star, steps, labels, attachments, *Focus*, sort order, list, delete.
- Resources haken cannot read (e.g. `RECURRENCE-ID` overrides) stay *Cannot be read* and untouched.

## Why

- The goal is to not break what haken does not understand. Only rule-dependent properties can be broken by haken's limited rule support; the others are independent properties.
- An edit changes only its own property group and preserves every other line as written (tested with unsupported rules, `EXDATE`/`RDATE` and unknown parameters), and the merge works per property group, so the rule is never touched.
- Locking the whole task blocked ordinary edits (e.g. label rename) for no safety gain.
