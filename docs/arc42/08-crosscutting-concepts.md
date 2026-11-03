# 8. Cross-cutting Concepts

## User interface

This chapter is the binding reference. The [sketches](sketches/README.md) illustrate it.

### Principles

- Simple and minimal. Every element on screen has a job. No decoration, gradients or illustrations.
- What is shown works. There are no half features and no settings without effect.
- One accent colour; everything else is neutral.
- System font stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). No web fonts.
- Icons are own inline stroke SVGs: `viewBox="0 0 24 24"`, stroke 1.75, round caps and joins, `currentColor`. No emoji.
- Touch targets are at least 44 × 44 px. Text contrast is at least 4.5:1 in both schemes.
- Semantic HTML: real `<button>`, `<a href>`, `<input>` + `<label>`, `<select>`, `<fieldset>`. Icon-only buttons carry `aria-label`; decorative SVGs carry `aria-hidden="true"`.
- All copy comes from message keys ([i18n](adr/ADR-20261103-i18n-json-messages.md)). The German strings in the sketches are examples.

### Screens

| Screen | Content |
| --- | --- |
| Lists | Smart lists *Today* (due today or overdue), *Important*, *Planned* and *All*, each with a count; a divider; the user's lists with counts; *New list* pinned at the bottom (mobile). The header shows the logo, the sync status (dot + text) and the settings entry. |
| List | Title and number of open tasks. Each task row has a drag handle, a complete circle, the title, one meta line (steps `x/y`, due date, attachment icon, label chips) and a star. Completed tasks are collapsed under *Completed · n*. The add-task field sits at the bottom on mobile (thumb reach) and at the top on desktop (Enter adds). |
| Task | Complete circle, title, star. Conflict notes, if any (see States). Steps as a checklist with *Add step*. One grouped block for due date, labels (chips + *Label*) and attachments (file name, size, *Attach file*). A note field (description). Footer with the creation date and delete. |
| Settings | Account (read-only): *This browser only*, or *Radicale server* with the server (the origin the app was loaded from) and the user name; *Log out*. Changing the storage mode or the user means logging out and running setup again ([Auth](adr/ADR-20261103-authentication.md)). Sync card: status, last sync, pending changes, *Sync now*. Appearance: theme *System/Light/Dark*, accent colour (`<input type="color">` + hex + *Default*), language (*System language*, then the native names from `locales/index.json`). Data: *Export (.ics)*, *Import*. App version. |

Smart lists are views and are never stored on the server. Their names are translated; user list names are not.

### Logo

- The mark is a checkmark drawn as a fish hook: an eye at the top of the long stroke, a small concave barb at the tip of the short stroke ([icons](../../web/icons/README.md)).
- Brand colours: `#1F4D45` mark on a `#F4EFE6` tile. The logo always keeps them; it does not follow the user's accent.
- In the app header the logo is `icons/icon.svg` as an `<img alt="">` at 28 px (26 px in the desktop sidebar), followed by the name *Haken* in 22/700.

### Layout

- **Mobile:** one screen at a time; the header holds back navigation, which is labelled with the parent's name.
- **Desktop:** three panes: sidebar (lists, 260 px), list (fluid, content max 760 px) and task detail (≥ 340 px, closable). The panes use `flex-wrap`, so they stack on narrow windows without breakpoint code. The selected list and selected task are highlighted with `--selected` / `--surface-2`.
- The settings screen scrolls; nothing else needs to scroll horizontally.

### Drag and drop

- Every open task shows a faint grip handle. Dragging starts only from the handle, so scrolling and tapping a row never reorder by accident (own Pointer Events code, see [Frontend](adr/ADR-20261103-vanilla-typescript-frontend.md)).
- While dragging, the task lifts as a card (shadow, −1° rotation, accent-coloured grip), and an accent line with a ring marks the drop position.
- Keyboard alternative: focus the handle, move with ↑ and ↓, drop with Enter or Space, cancel with Esc.
- Completed tasks cannot be reordered. Persistence follows the [data mapping](adr/ADR-20261103-vtodo-mapping.md).

### Design tokens

Colours are written as `light-dark(<light>, <dark>)` ([Theming](adr/ADR-20261103-theming.md)).

| Token | Use | Light | Dark |
| --- | --- | --- | --- |
| `--bg` | Page | `#FFFFFF` | `#121416` |
| `--surface` | Grouped blocks, sync card, sidebar | `#F5F6F7` | `#1C1F22` |
| `--surface-2` | Chips, add field, segmented track | `#F1F3F4` | `#24282C` |
| `--selected` | Selected list, active segment (dark) | `#E9EBED` | `#2E3338` |
| `--border` | Inputs, cards | `#E4E6E9` | `#2E3338` |
| `--divider` | Between task rows | `#EEF0F2` | `#23272B` |
| `--text` | Primary text | `#1A1C1F` | `#E8EAED` |
| `--text-2` | Secondary text, chip text | `#3D4249` | `#C9CDD2` |
| `--text-muted` | Meta, labels, counts | `#5E636B` | `#A4AAB2` |
| `--control` | Unchecked circles, inactive star | `#8A8F97` | `#7C838C` |
| `--grip` | Drag handle | `#9AA0A8` | `#6B727B` |
| `--accent` | Links, completed state, primary button, focus | user, default `#1F4D45` | derived, default `#618F86` |
| `--on-accent` | Text on accent fills | derived (default `#FFFFFF`) | derived (default `#000000`) |

| Scale | Values |
| --- | --- |
| Type (px / weight) | 30/700 page title · 22–24/700 task title · 16 task rows · 15 body and controls · 13 meta and labels · 12 chips and footnotes |
| Radius (px) | 8 sidebar rows and icon buttons · 12 inputs and buttons · 14 cards and groups · 999 chips · 50 % check circles |
| Spacing | 4 px grid; screen gutter 16–20 px; row height ≥ 44 px (task rows ≈ 56 px, list rows 52 px) |
| Elevation | Only the dragged task: `0 10px 28px` at 16 % (light) / 50 % (dark) |

### States

- The sync status is always visible: a dot + text (*Synced*, *Offline*, *n changes pending*, *Sign in to sync*). In browser-only mode it says that there is no server copy ([Browser-only](adr/ADR-20261103-browser-only-mode.md)).
- Conflicts never open a dialog ([Sync](adr/ADR-20261103-sync-strategy.md)). The task detail lists each conflict note: property, the overwritten value, *Use this value*, *Dismiss*. The user does not have to act; the note and its marker stay until one of the two is chosen. A task with a conflict note shows a small marker in its meta line. While the app is visible, a non-blocking notice names a task that was merged.
- A completed task or step shows a filled accent circle with an `--on-accent` check, and its text is struck through and muted.
- An important task shows a filled star in the accent colour.

### Not designed yet

- First start and setup screens. The flow and the content of each step are defined in [Runtime View](06-runtime-view.md#first-start-and-setup); the screens follow this chapter.
- Empty list, offline, conflict note and notice, logout confirmation.
