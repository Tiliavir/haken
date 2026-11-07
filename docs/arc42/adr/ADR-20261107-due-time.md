# ADR-20261107: Due time of day

Status: Proposed (implementation: [#15](https://github.com/Tiliavir/haken/issues/15))

## Decision

- A due date may have a time of day. haken writes it as a floating `DATE-TIME` (no `TZID`, no `Z`), to the minute: `DUE:20261109T093000`. Removing the time writes a `DATE` again; changing the date keeps the time.
- Due date-times from other clients (UTC, `TZID`) are read as before; once the date or time is edited in haken, they are written floating.
- *Due today* and *overdue* stay by day ([Focus](ADR-20261104-focus.md)).
- Repeating tasks ([recurrence](ADR-20261104-recurrence.md)): when `DUE` keeps its form, `DTSTART` moves by the same wall-clock amount. When the form changes (time added or removed, `TZID` written floating), `DTSTART` keeps its distance in days and takes the form and time of `DUE`. `UNTIL` follows the form of `DTSTART`: a date, a floating end of day (`T235959`), or UTC for UTC and `TZID` series.
- Supersedes "haken writes `DUE` as a date" in the [implementation baseline](ADR-20261105-implementation-baseline.md).

## Why

- Occurrences keep the written time of day. Floating keeps "every Monday at 9" at 9 across DST; UTC would move it by an hour.
- A `TZID` needs a `VTIMEZONE`, and the browser has no time-zone rules to write one.
- Floating is valid RFC 5545 and read as local time by DAVx⁵, Tasks.org and Thunderbird. On a device in another time zone the task shows the same clock time, which is what a personal to-do list wants.
- RFC 5545 requires `DTSTART` and `DUE` of the same value type, and `UNTIL` in the form of `DTSTART`.
