# 8. Cross-cutting Concepts

## User interface

This chapter is the binding reference. The [sketches](sketches/README.md) illustrate it.

### Principles

- Simple and minimal. Every element on screen has a job. No decoration, gradients or illustrations.
- What is shown works. There are no half features and no settings without effect.
- One accent colour; everything else is neutral. Red (`--danger`) is the one exception, and only for "needs attention": overdue dates, errors, destructive actions ([Focus](adr/ADR-20261104-focus.md)).
- System font stack (`system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). No web fonts.
- Icons are own inline stroke SVGs: `viewBox="0 0 24 24"`, stroke 1.75, round caps and joins, `currentColor`. No emoji.
- Touch targets are at least 44 × 44 px. On touch screens (`pointer: coarse`) every size is one step larger (see Design tokens). Text contrast is at least 4.5:1 in both schemes.
- Semantic HTML: real `<button>`, `<a href>`, `<input>` + `<label>`, `<select>`, `<fieldset>`. Icon-only buttons carry `aria-label`; decorative SVGs carry `aria-hidden="true"`. Every control has an accessible name (E2E checks Chrome's accessibility tree on every screen). `<select>` has `appearance: none` and one chevron (`styles/select-arrow.svg`, `#8A8F97`, ≥ 3:1 in both schemes), so the arrow sits the same on every platform.
- In dialogs, a field's label sits above the field.
- All copy comes from message keys ([i18n](adr/ADR-20261103-i18n-json-messages.md)). The German strings in the sketches are examples.

### Screens

| Screen | Content |
| --- | --- |
| Lists | Smart lists *Focus* (due today or overdue first, then the tasks put on Focus; no daily reset), *Important*, *Planned* and *All*, each with a count; a divider; the section *Labels*: every label in use, with a tag icon (or the label's emoji, [label emoji](adr/ADR-20261113-label-emoji.md)) and the count of open tasks ([label views](adr/ADR-20261108-label-views.md)), hidden while no task has a label, reordered by dragging the row and kept on this device, labels not yet ordered after them by name ([label order](adr/ADR-20261111-label-order.md)); the user's lists (heading *Lists* while *Labels* is shown) with counts, their icon in the list's `calendar-color`, in `calendar-order` (then by name; *errorlogs* last), reordered by dragging the row (see Drag and drop; writes `calendar-order` 1…n); *New list* pinned at the bottom (mobile). The header shows the logo, the sync status (dot + text) and the settings entry. |
| List | Title and number of open tasks. *Edit list* (user lists, not *errorlogs*) opens a dialog: name, *Save*, and *Delete list*; deleting needs the list name typed in, only then is the `--danger` button enabled. A label view has *Edit label* instead: name, emoji (optional, on this device), *Save*, and *Delete label* after a confirmation with the number of tasks ([label edit](adr/ADR-20261108-label-edit.md)). Each task row has a complete circle, the title, one meta line (checklist `x/y`, due date, repeat icon + rule, attachment icon, label chips) and a star. Completed tasks are collapsed under *Completed · n*. The add-task field sits at the bottom on mobile (thumb reach) and at the top on desktop (Enter adds). In a smart list it reads *Add to ‹list›* and adds to the first user list; in a label view *Add to ‹label›*, with the label; *Planned* and *Focus* use the day of submitting. Pasting several lines into an add field (tasks or *Add item*) adds one item per non-blank line, trimmed, in pasted order, combined with the field's text at the cursor. |
| Task | Complete circle, title, star. Conflict notes, if any (see States). *Checklist* (child tasks) with *Add item*. One grouped block for due date, time (only with a due date), repeat (*Never* … *Custom*; custom: every N + unit, weekday chips for weeks, day or ordinal weekday for months; *Ends* never / after N times / on date), labels (chips + *Label*, suggesting labels in use; added on Enter or when leaving the field) and attachments (file name, size, *Attach file*). The *List* row is hidden while there is only one user list. Rows: icon, label, then value controls (list, due, time, repeat, every, ends) in one 11rem column at the end, so edges line up; the remove buttons of due date and time sit inside the field's reserved end padding. Completing a repeating task moves it to its next due date and shows a notice with that date ([recurrence](adr/ADR-20261104-recurrence.md)). A note field (description). Footer with the creation date and delete. |
| Settings | Account (read-only): *This browser only*, or *Radicale server* with the server (the origin the app was loaded from) and the user name; *Log out*. Changing the storage mode or the user means logging out and running setup again ([Auth](adr/ADR-20261103-authentication.md)). Sync card: status, last sync, pending changes, *Sync now*. Appearance: theme *System/Light/Dark*, accent colour (`<input type="color">` + hex + *Default*), language (*System language*, then the native names from `locales/index.json`). Data: *Export (.ics)*, *Import*. App version. |

Smart lists are views and are never stored on the server. Their names are translated; user list names are not. The list *errorlogs* ([strict errors](adr/ADR-20261104-strict-errors.md)) appears with the user's lists once it exists and is excluded from smart lists, label views and their counts.

### Logo

- The mark is a checkmark drawn as a fish hook: an eye at the top of the long stroke, a small concave barb at the tip of the short stroke ([icons](../../web/icons/README.md)).
- Brand colours: `#1F4D45` mark on a `#F4EFE6` tile. The logo always keeps them; it does not follow the user's accent.
- In the app header the logo is `icons/icon.svg` as an `<img alt="">` at 28 px (26 px in the desktop sidebar), followed by the name *Haken* in 22/700.

### Layout

- **Mobile:** one screen at a time. Back is a chevron before the title, in the slot the logo takes on the lists screen, so every title sits on the same line; its accessible name is *Back to* + the parent's name.
- **Desktop:** three panes side by side, never stacked: sidebar (lists, 260 px), list (fluid, content max 760 px) and task detail (≥ 340 px, closable). Below 1060 px, where all three do not fit, the task detail overlays the list from the right edge. The selected list and selected task are highlighted with `--selected` / `--surface-2`.
- The settings screen scrolls; nothing else needs to scroll horizontally.
- Avoid breakpoint code; layouts adapt through `flex-wrap` and intrinsic sizes. Exceptions (CSS media queries only, no layout code in JS): mobile shows one pane at a time at ≤ 720 px; the desktop task detail overlays below 1060 px; `pointer: coarse` scales the root font size.
- All modals use one `<dialog>` owned by `<haken-app>`; a re-render never closes it. Text in the focused field survives a re-render.
- After deleting a task or list, focus moves to the next row, else the previous one, else the add field (*Add a task* / *New list*).
- **Updates** ([app update](adr/ADR-20261107-app-update.md)): a new version shows a bar *A new version of Haken is ready.* with *Reload* above the bottom edge until reloaded. After an update, *What's new* opens once: per version a heading, the summary and the changelog sections (English text); only the entries scroll.

### Drag and drop

- The whole row is the handle ([row drag](adr/ADR-20261106-row-drag.md)); controls in it (circle, star) keep their own action. Touch: hold 300 ms without moving, then drag; a swipe scrolls. Mouse and pen: drag starts after 5 px; a click opens. Own Pointer Events code, see [Frontend](adr/ADR-20261103-vanilla-typescript-frontend.md).
- While dragging, the row lifts as a card (shadow, scale 1.02, −1° rotation) and follows the pointer; the rows between its slot and the drop position slide aside (CSS transition, 160 ms; none with `prefers-reduced-motion`) to open a gap where it lands.
- Keyboard: Alt+↑ / Alt+↓ on the focused row moves it one place (`aria-keyshortcuts`).
- Every move, by pointer or keyboard, is announced in one polite live region outside the re-rendered tree: *‹title› moved to position n of m*.
- Completed tasks cannot be reordered. Persistence follows the [data mapping](adr/ADR-20261103-vtodo-mapping.md). In *Focus* each part (due, picked) is reordered within itself ([Focus](adr/ADR-20261104-focus.md)).
- Dropping a task row on a label in the sidebar labels it; from a label view it replaces that view's label ([label views](adr/ADR-20261108-label-views.md)).
- *Add to/Remove from Focus* and *Move to list* are on the task screen.

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
| `--accent` | Links, completed state, primary button, focus | user, default `#1F4D45` | derived, default `#618F86` |
| `--on-accent` | Text on accent fills | derived (default `#FFFFFF`) | derived (default `#000000`) |
| `--danger` | Overdue dates, destructive buttons | `#A1262B` | `#F08A8E` |

| Scale | Values |
| --- | --- |
| Type (px / weight, ×1.125 on touch screens) | 30/700 page title · 22–24/700 task title · 16 task rows · 15 body, controls and card titles (600, sentence case; no all caps) · 13 meta and labels · 12 chips and footnotes |
| Radius (px) | 8 sidebar rows and icon buttons · 12 inputs and buttons · 14 cards and groups · 999 chips · 50 % check circles |
| Spacing | Sizes are `rem` (base 16 px; 18 px with `pointer: coarse`), borders and shadows `px`; 4 px grid; screen gutter 16–20 px; row height ≥ 44 px (task rows ≈ 56 px, list rows 52 px) |
| Elevation | Only the dragged row: `0 10px 28px` at 16 % (light) / 50 % (dark) |

### States

- The sync status is always visible: a dot + text (*Synced*, *Offline*, *n changes pending*, *Sign in to sync*, *Sync error* and *n items not synced* ([quarantine](adr/ADR-20261104-sync-quarantine.md)), both linking to the errorlogs list). At the top of *errorlogs*, *Not synced · n* lists the quarantined tasks and lists, each linked to it (title or list name; the server path if it is not on the device), with a hint that changing an item retries it. In browser-only mode it says that there is no server copy ([Browser-only](adr/ADR-20261103-browser-only-mode.md)).
- Conflicts never open a dialog ([Sync](adr/ADR-20261103-sync-strategy.md)). The task detail lists each conflict note: property, the overwritten value, *Use this value*, *Dismiss*. A note on the whole task (the server version cannot be read) shows a short explanation instead of the value, with *Export (.ics)* and *Dismiss*. The user does not have to act; the note and its marker stay until one of the two is chosen. A task with a conflict note shows a small marker in its meta line. While the app is visible, a non-blocking notice names a task that was merged.
- A task the server refused as too large (`413`) shows an error on the task; it is sent again only after it changed.
- Device storage over 80 % of the quota: a notice at start and when the app becomes visible again.
- Logout with pending changes: *Export pending changes, then delete* asks after the download whether the file is saved and deletes only on confirmation.
- A completed task or checklist item shows a filled accent circle with an `--on-accent` check, and its text is struck through and muted.
- An important task shows a filled star in the accent colour.
- Due dates in the meta line, with the time if set (*Tomorrow, 09:30*): overdue in `--danger` with *Overdue*; due today bold with an accent exclamation mark; on Focus a sun marker.
- A task row can be dragged onto *Focus* in the sidebar; the entry is outlined while the task is over it. The task screen has *Add to Focus* / *Remove from Focus*.
- *Focus* has *Quick add* in its header: a dialog with a filter field and the open tasks not in Focus, grouped *Due soon* (7 days), *Important*, then per list; *+* adds a task and keeps the dialog open ([Quick add](adr/ADR-20261107-focus-quick-add.md)).

### Setup and transient screens

Rendered in [sketches/app](sketches/README.md#app-screens).

- **Setup** (flow and content: [Runtime View](06-runtime-view.md#first-start-and-setup)): one step per screen, no app chrome. The logo tile, a page title, one paragraph, then the step's controls. Choices are full-width cards (`--surface`, title plus one muted line). The primary action is a filled accent button on the right; *Skip* and *Later* are plain buttons.
- **Empty list:** *No tasks yet.* centred and muted; the add field stays in place.
- **Offline, signed out:** the status line reads *Offline* (grey dot) or *Sign in to sync*, followed by *· n changes pending* when edits wait. On mobile the status line is on the lists screen.
- **Notice:** a toast at the bottom centre for 5 s, inverted colours, naming the task by its title after the sync run.
- **Logout with pending changes:** a dialog with the pending count; *Cancel* is the primary button, then *Log out, keep data on this device* and *Export pending changes, then delete*. Discarding needs the count typed in; only then is the `--danger` button enabled.

