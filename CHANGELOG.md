# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versions: [Semantic Versioning](https://semver.org/). Releasing is described in
[CONTRIBUTING.md](CONTRIBUTING.md#releasing).

## [Unreleased]

### Changed

- Larger text and spacing on touch screens.
- Drag a task or list by the whole row (touch: hold first); rows slide aside to show where it lands. Alt+↑/↓ moves the focused row.

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
