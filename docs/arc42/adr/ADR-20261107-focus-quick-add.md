# ADR-20261107: *Quick add* in *Focus*

Status: Proposed

## Decision

- *Focus* has a *Quick add* button in its header. It opens the dialog with the open tasks that are not in *Focus* yet (not on Focus, not due today or overdue; not *errorlogs*).
- Each task shows once, in the first group it matches:
  1. *Due soon*: due in the next 7 days, by due date.
  2. *Important*: starred, in list and task order.
  3. One group per list, in list and task order.
  Empty groups are hidden. A filter field narrows the groups by title (case ignored).
- *+* on a row puts the task on Focus (`X-HAKEN-FOCUS`, the day of the tap, as in [Focus](ADR-20261104-focus.md)). The dialog stays open; the row disappears and keyboard focus moves to the next row.
- No new stored state: the groups are computed from the local store.

## Why

- Picking several tasks one by one through the task screen is slow; one dialog with the likely candidates first makes the daily choice quick.
- The dates and the star already say what is likely needed today, so the groups need no new data. Seven days covers a week ahead without listing everything.
