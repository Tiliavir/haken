# ADR-20261104: Repeating tasks

Status: Accepted

## Decision

- **Completing advances the same task.** `DUE` moves to the next occurrence after the current due date and `DTSTART` moves by the same amount. The task stays open (`STATUS:NEEDS-ACTION`, no `COMPLETED`), and its steps are reopened in the same commit. Same `UID`, no copy, no history entry.
- **Editable rules:** `FREQ` `DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`; `INTERVAL` 1–999; for weekly rules plain weekdays in `BYDAY`; `WKST=MO` or none. The UI offers *Never, Daily, Weekdays, Weekly, Monthly, Yearly, Custom* (every N days/weeks/months/years, weekdays). No end date.
- **Other valid rules** (`COUNT`, `UNTIL`, `BYMONTHDAY`, `BYDAY` with ordinals, sub-daily, `RDATE`, `EXDATE`, a rule without `DUE`/`DTSTART`) are preserved; the task is read-only in haken.
- **Invalid rules are invalid input** ([strict errors](ADR-20261104-strict-errors.md)). The `RRULE` text is validated as written: ical.js repairs some invalid values silently (`INTERVAL=0` becomes 1).
- **Per-occurrence overrides** (`RECURRENCE-ID`, more than one VTODO per resource) stay *Cannot be read*.
- **Occurrences** are computed by haken on the written wall-clock fields: `TZID`, UTC and floating values keep their form and time of day, also across DST. Months or years without the day are skipped (31st, 29 February), as RFC 5545 requires.
- Setting a rule on a task without a due date sets today; a new rule gets a `DTSTART` equal to `DUE`. Moving the due date moves `DTSTART` by the same amount; removing the due date removes the rule.
- Merge: `RRULE` and `DTSTART` are property groups of their own ([sync](ADR-20261103-sync-strategy.md)). Two devices completing the same occurrence write the same `DUE`, so there is no conflict.
- Not supported yet: *repeat after completion*, end conditions, editing overrides.

## Why

- Tasks.org and Apple Reminders advance the same task, so users of DAVx⁵ and haken see the same list.
- A small, fully specified subset can be computed and tested exactly; anything else is kept untouched rather than half-understood.
- ical.js normalises `29 February + 1 year` to `1 March`, which RFC 5545 forbids; computing the subset ourselves avoids depending on that.
- Wall-clock arithmetic is what users expect from "every Monday at 9".
