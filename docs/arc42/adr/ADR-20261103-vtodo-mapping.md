# ADR-20261103: Feature to iCalendar mapping

Status: Proposed

## Decision

| Feature | Property |
| --- | --- |
| List | CalDAV collection (`displayname`, `calendar-color`, `calendar-order`) |
| Title / description | `SUMMARY` / `DESCRIPTION` (plain text) |
| Done | `STATUS:COMPLETED`, `COMPLETED`, `PERCENT-COMPLETE:100` |
| Important | `PRIORITY:1` |
| Due / reminder | `DUE` / `VALARM` |
| Labels | `CATEGORIES` |
| Manual order | `X-APPLE-SORT-ORDER` |
| Steps | Child `VTODO` with `RELATED-TO` (RFC 9253) |
| Attachments | `ATTACH` |
| My Day | `X-HAKEN-MYDAY:<date>` |

Edits modify the parsed component in place; unknown properties are written back unchanged.

## Why

- Standard properties keep tasks usable in other clients.
- `X-APPLE-SORT-ORDER` is what Tasks.org, Apple Reminders and Nextcloud Tasks use for manual order ([Tasks.org docs](https://tasks.org/docs/manual_sort_mode.html)).
- No standard exists for My Day; an `X-` property is ignored by others.
