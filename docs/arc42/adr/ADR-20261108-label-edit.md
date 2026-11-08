# ADR-20261108: Rename and delete labels

Status: Accepted

Supersedes, in [label views](ADR-20261108-label-views.md), "there is no separate create, rename or delete" and "below the user's lists".

## Decision

- A label view has *Edit label* next to its title, like *Edit list*: a dialog with the name, *Save* and *Delete label*.
- **Rename** rewrites `CATEGORIES` of every task carrying the label (steps and completed tasks included, not *errorlogs*): the label is replaced in place. Renaming to a label a task already has leaves it once (set semantics), so renaming to an existing label merges both.
- **Delete** removes the label from those tasks; the tasks stay. A confirmation names the label and the number of tasks.
- Every rewritten task is a normal edit: one `PUT` per task with `If-Match`, the [set merge](ADR-20261104-set-merge.md) on `412`. All tasks change in one local transaction.
- Tasks with a repeat rule haken cannot edit are rewritten too: a label edit does not depend on the rule ([rule-locked edits](ADR-20261108-rule-locked-edits.md)). Resources haken cannot read (e.g. `RECURRENCE-ID` overrides) keep their labels: haken does not know them.
- The sidebar shows *Labels* between the smart lists and the user's lists; the user's lists get the heading *Lists* while *Labels* is shown.

## Alternatives

Skipping such tasks (rename only half done) or refusing while one carries the label (blocks the user) were rejected once [rule-locked edits](ADR-20261108-rule-locked-edits.md) made their labels editable.

## Why

- Renaming or deleting a label is otherwise one edit per task by hand.
- A rename is a property change per task, so the existing edit, outbox and merge rules apply unchanged; nothing new is stored.
- Labels are what a single-collection setup uses as lists, so they come first in the sidebar.
