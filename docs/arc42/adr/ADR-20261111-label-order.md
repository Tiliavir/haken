# ADR-20261111: Label order kept on the device

Status: Accepted

Supersedes, in [label views](ADR-20261108-label-views.md), "sorted by name".

## Decision

- Labels in the sidebar are reordered by dragging the row (Alt+↑/↓ on the keyboard), like lists.
- The order is stored per account on this device (IndexedDB `state`, key `labelOrder`), not on the server. Labels in it come first, in that order; labels not in it follow by name. A label no task carries any more is skipped.
- Rename keeps the label's place; renaming onto another label keeps the higher of the two places; delete removes it from the order.

## Alternatives

A dead property on the calendar home (`PROPPATCH`) would sync the order, but needs a new outbox kind, conflict rules and server support beyond CalDAV; no other client reads it. Revisit when the order should follow the user to another device.

## Why

- A label has no resource of its own, and no standard stores an order of `CATEGORIES`; Tasks.org keeps its tag settings on the device too.
- Nothing changes on the server or in other clients' data.
