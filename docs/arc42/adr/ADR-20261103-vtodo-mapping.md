# ADR-20261103: Feature to iCalendar mapping

Status: Accepted

## Decision

| Feature | Property |
| --- | --- |
| List | CalDAV collection (`displayname`, `calendar-color`, `calendar-order`) |
| Title / description | `SUMMARY` / `DESCRIPTION` (plain text) |
| Done | `STATUS:COMPLETED`, `COMPLETED`, `PERCENT-COMPLETE:100` |
| Important | `PRIORITY` 1–4 (see below) |
| Due / reminder | `DUE` / `VALARM` |
| Repeat | `RRULE` + `DTSTART` ([recurrence](ADR-20261104-recurrence.md)) |
| Labels | `CATEGORIES` |
| Manual order | `X-APPLE-SORT-ORDER` |
| Steps | Child `VTODO` with `RELATED-TO` (RFC 9253) |
| Attachments | `ATTACH;VALUE=BINARY;ENCODING=BASE64;FMTTYPE=…;FILENAME=…` (see below) |
| On *Focus* | `X-HAKEN-MYDAY:<YYYYMMDD>` ([Focus](ADR-20261104-focus.md)) |
| Modification time | `LAST-MODIFIED`, `DTSTAMP` (UTC, written on every change) |

Edits modify the parsed component in place; unknown properties are written back unchanged.

### Priority

RFC 5545 defines `PRIORITY` 1–4 as high, 5 as medium, 6–9 as low and 0 or absent as undefined.

- Read: 1–4 is *Important*.
- Star: sets `PRIORITY:1`. Unstar: sets `PRIORITY:0`. Values 5–9 from other clients are kept untouched until the user stars the task.

### Due dates and *Focus*

- `DUE` may be a `DATE` or a `DATE-TIME` (UTC, with `TZID`, or floating). haken writes a `DATE` unless the user sets a time.
- The smart list *Focus* shows open tasks due today or overdue, by the device's time zone, followed by the tasks put on Focus ([Focus](ADR-20261104-focus.md)).

### Attachments

- Stored inline, base64. The `FILENAME` parameter is from RFC 8607.
- Limit: 5 MB per file before encoding, checked before the file is added. CalDAV has no way to discover the server's request limit (Radicale's `max_content_length` defaults to 100 MB); a `413` keeps the change in the outbox and shows an error on the task.
- `ATTACH` with a URI (written by other clients) is shown as a link and never fetched automatically; opening it is a user navigation.

## Why

- Standard properties keep tasks usable in other clients.
- `X-APPLE-SORT-ORDER` is what Tasks.org, Apple Reminders and Nextcloud Tasks use for manual order ([Tasks.org docs](https://tasks.org/docs/manual_sort_mode.html)).
- Following the RFC 5545 priority ranges means a high priority set elsewhere shows as *Important*, and unstarring never rewrites medium or low priorities.
- Inline attachments need no second store and travel with the task. The whole `VTODO` is transferred on every change and pull, so files stay small. Tasks.org does not sync attachments ([Tasks.org sync](https://tasks.org/docs/sync.html)); whether it keeps haken's `ATTACH` on its own writes is covered by the interop round-trip tests.
- Fetching URI attachments automatically would contact hosts other than the user's server.
- No standard exists for *Focus*; an `X-` property is ignored by others.
