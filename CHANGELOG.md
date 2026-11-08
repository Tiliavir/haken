# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions: [Semantic Versioning](https://semver.org/). Releasing is described in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## [0.6.2] - 2026-11-08

### Fixed

- A label typed into a task is no longer lost when leaving the field without Enter.

## [0.6.1] - 2026-11-08

### Added

- *Edit label* in a label view: rename a label or delete it on all its tasks. Renaming to an existing label merges both; deleting keeps the tasks.

### Changed

- *Labels* now appear above the lists in the sidebar.
- Tasks that repeat in a way Haken cannot edit are no longer read-only: only completing them and changing their dates or repeat are blocked.

## [0.6.0] - 2026-11-08

Labels become views in the sidebar, so a task can sit in several of them.

### Added

- The sidebar lists every label in use under *Labels*, with its count of open tasks. A label opens like a list.
- Adding a task in a label view gives it that label; tasks there can be reordered by dragging.
- Drag a task onto a label to label it; from a label view this moves it to the other label.
- The label field suggests labels already in use.

### Changed

- The task screen hides the *List* choice while there is only one list.

### Fixed

- On narrower desktop windows the task detail overlays the list instead of appearing below it.

### Security

- Sign-in no longer sends the password when the page is not loaded over HTTPS (localhost excepted).

## [0.5.2] - 2026-11-08

Sign-in and sync work in Firefox.

### Fixed

- Firefox no longer sends `Origin: null` on sign-in and sync requests, which the server refused.

## [0.5.1] - 2026-11-08

Sign-in works in Firefox.

### Fixed

- Signing in works in Firefox (it was refused as a cross-site request).

## [0.5.0] - 2026-11-07

Pick tasks for *Focus* from one dialog.

### Added

- *Quick add* in *Focus*: pick tasks to put on Focus from one dialog, due soon and important ones first.

## [0.4.0] - 2026-11-07

Due times, a calmer update and better keyboard and screen reader support.

### Added

- When a new version is ready, a bar offers *Reload*; after an update, *What's new* shows the changes once.
- A due date can have a time of day; the task row shows it.
- Screen readers announce where a dragged or Alt+↑/↓-moved task or list landed.

### Changed

- Renaming and deleting a list moved into one *Edit list* dialog; deleting a list needs its name typed in.
- After deleting a task or a list, focus moves to the next one (else the previous one, else the add field).

## [0.3.0] - 2026-11-07

Faster entry: paste a whole list at once.

### Added

- Pasting several lines into the add-task or *Add item* field adds one task or item per line.

## [0.2.0] - 2026-11-07

Better on the phone: larger controls, drag by the whole row, a calmer layout.

### Changed

- Larger text and spacing on touch screens.
- Settings section titles in sentence case.
- Mobile: the back arrow sits before the title instead of above it; titles stay on the same line on every screen.
- Drag a task or list by the whole row (touch: hold first); rows slide aside to show where it lands. Alt+↑/↓ moves the focused row.

### Fixed

- Drop-down arrows sit at the same place on every platform.
- Task form: list, due date, repeat and its sub-fields share one column width; removing the due date no longer moves the field; the monthly day choice is styled.
- Weekdays of a custom repeat stay on one line; the *Attach file* button and the label field line up with their icons; theme label and settings buttons align with the other content.

### Removed

- Long-press and right-click actions on task rows; *Add to Focus* and *Move to list* stay on the task screen.

## [0.1.0] - 2026-11-06

First release: an installable, offline-first to-do app that keeps its tasks
as standard `VTODO`s on your own CalDAV server.

### Added

- Lists with manual drag-and-drop order.
- Tasks with checklists, labels, attachments and due dates.
- Repeating tasks.
- Focus view and smart lists.
- Offline use; sync with the CalDAV server when it is reachable, with automatic
  conflict merge.
- Browser-only mode, no server needed.
- `.ics` export and import.
- Six languages and themes.
- Container image `ghcr.io/tiliavir/haken` (gateway and app).
