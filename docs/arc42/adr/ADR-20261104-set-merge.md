# ADR-20261104: Labels and attachments merge as sets

Status: Accepted

Supersedes, for `CATEGORIES` and `ATTACH`, the rule "same property changed on both sides: the newer edit wins, the losing value is kept as a conflict note" in [ADR-20261103-sync-strategy](ADR-20261103-sync-strategy.md).

## Decision

- `CATEGORIES` and `ATTACH` are merged as sets: result = (server ∪ added) − removed, where *added* and *removed* are the local changes against the merge base. Without a merge base: the union.
- A label is one `CATEGORIES` value. An attachment is identified by its whole property (value and parameters); the same file with other parameters is a different attachment.
- No conflict note for these two groups.

## Why

- Adding a label or a file on one device and another on a second device is the normal case, not a conflict. Newer-wins would drop one addition and leave the user to restore it from a note.
- The set merge keeps every addition from both sides and only applies removals the user actually made, so nothing is lost without a user action.
- Identifying an attachment by its whole property needs no guess about which parameters matter; at worst both versions are kept.
