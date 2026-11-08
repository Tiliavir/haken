# ADR-20261108: Rename and delete labels

Status: Proposed

Supersedes, in [label views](ADR-20261108-label-views.md), "there is no separate create, rename or delete" and "below the user's lists".

## Decision

- A label view has *Edit label* next to its title, like *Edit list*: a dialog with the name, *Save* and *Delete label*.
- **Rename** rewrites `CATEGORIES` of every task carrying the label (steps and completed tasks included, not *errorlogs*): the label is replaced in place. Renaming to a label a task already has leaves it once (set semantics), so renaming to an existing label merges both.
- **Delete** removes the label from those tasks; the tasks stay. A confirmation names the label and the number of tasks.
- Every rewritten task is a normal edit: one `PUT` per task with `If-Match`, the [set merge](ADR-20261104-set-merge.md) on `412`. All tasks change in one local transaction.
- **Read-only tasks keep the label** (option A below). Afterwards a notice says how many tasks were skipped; the label stays in the sidebar while one of them carries it.
- The sidebar shows *Labels* between the smart lists and the user's lists; the user's lists get the heading *Lists* while *Labels* is shown.

## Read-only tasks

Read-only are tasks with a repeat rule haken cannot edit ([recurrence](ADR-20261104-recurrence.md)). Resources haken cannot read (e.g. `RECURRENCE-ID` overrides) are not affected by any option: haken does not know their labels, and they keep them.

| | A: skip, report | B: rewrite `CATEGORIES` anyway | C: refuse while one carries it |
| --- | --- | --- | --- |
| Strengths | Read-only stays absolute; simplest rule; user is told | Label is fully renamed / gone | Label never half-renamed |
| Weaknesses | Old label lives on for skipped tasks | Exception to read-only; writes resources haken does not fully understand | Blocks the user; fix needs another client |
| Opportunities | Same rule for any future read-only case | Could allow label edits on read-only tasks in the task screen too | — |
| Threats | User overlooks the notice | A wrong write of a rule haken cannot read is data loss | User renames per task by hand, more error-prone |

Suggestion: **A**. It keeps one rule ("haken does not write read-only tasks") without exceptions and loses nothing; the remaining label is visible and can be fixed in the client that understands the rule.

## Why

- Renaming or deleting a label is otherwise one edit per task by hand.
- A rename is a property change per task, so the existing edit, outbox and merge rules apply unchanged; nothing new is stored.
- Labels are what a single-collection setup uses as lists, so they come first in the sidebar.
