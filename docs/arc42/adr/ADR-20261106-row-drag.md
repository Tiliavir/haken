# ADR-20261106: Drag the whole row; no row actions

Status: Proposed

## Decision

- A task row and a list row are dragged as a whole; there is no grip. Touch lifts the row after a 300 ms hold without moving (a swipe scrolls); mouse and pen lift it after a 5 px move (a click opens). Keyboard: Alt+↑ / Alt+↓ on the focused row moves it one place.
- The long-press / right-click actions on a task row (*Add to Focus*, *Move to list*) are removed. Put on Focus: *Add to Focus* in the task screen or drag the row onto *Focus* in the sidebar. This supersedes that point of [ADR-20261104-focus](ADR-20261104-focus.md).

## Why

- The grip is a small touch target; the whole row is the target users expect.
- Long-press cannot mean both "drag" and "actions". The task screen already has both actions, so the shortcut was a second way to do the same.
