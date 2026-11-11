# ADR-20261108: Labels as views in the sidebar

Status: Accepted; partly superseded by [label-edit](ADR-20261108-label-edit.md), [label-order](ADR-20261111-label-order.md)

## Decision

- Lists stay CalDAV collections; labels stay `CATEGORIES` ([mapping](ADR-20261103-vtodo-mapping.md)). Nothing new is stored.
- The sidebar shows every label used on a task (not *errorlogs*) in its own section *Labels*, below the user's lists, sorted by name, each with its count of open tasks. The section is hidden while no task has a label. A label exists as long as a task carries it; there is no separate create, rename or delete.
- A label opens a view like a list: the top-level tasks of all user lists that carry it.
  - Adding a task there puts it, with this label, into the first user list.
  - Manual order is the task's `X-APPLE-SORT-ORDER`, so a task has one place in every view that shows it.
- Dragging a task row onto a label in the sidebar labels it. From a label view it **moves** the task: the current label is replaced by the target one.
- The task screen hides the *List* row while there is only one user list, and the label field suggests existing labels.

## Why

- Tasks.org and others show tags this way, and a common setup is one collection with tags as "lists". A task can then be in several of them, and moving is a property change instead of a new resource.
- Keeping collections as lists stays interoperable: other CalDAV clients show the same lists, empty lists exist, and renaming a list is one request.
- One sort order per task is what other clients read and write; a per-label order has no standard.
- Rename and delete of a label would rewrite every task carrying it and need rules for read-only tasks; not needed yet.
