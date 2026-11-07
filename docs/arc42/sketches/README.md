# UI sketches

Static renders of the design canvas "Haken UI Sketches". They illustrate
[chapter 8](../08-crosscutting-concepts.md), which is binding where the two
differ. The copy is German example text; the app takes all copy from message
keys.

Rendered with the default accent (`#1F4D45`, dark `#618F86`) and the real logo.

| Mobile | |
| --- | --- |
| ![Lists](mobile-lists.png) | ![List with drag and drop](mobile-list.png) |
| Lists | List, task being dragged |
| ![Task](mobile-task.png) | ![Settings](mobile-settings.png) |
| Task | Settings |

| Dark | |
| --- | --- |
| ![List, dark](mobile-list-dark.png) | ![Settings, dark](mobile-settings-dark.png) |

Desktop, three panes:

![Desktop](desktop.png)

Known differences to chapter 8: the settings sketches still show the old
storage selector instead of the read-only account block with *Log out*; the list sketches show grips (rows are dragged as a whole now) and the desktop text size.

## App screens

Screenshots of the running app (phone, light, English, synthetic data),
rendered by `SCREENS=1 npx playwright test screens` after `make gateway`.

| Setup | | |
| --- | --- | --- |
| ![Welcome](app/setup-1-welcome.png) | ![Intro](app/setup-2-intro.png) | ![Storage](app/setup-3-storage.png) |
| Welcome | Intro | Storage |
| ![Sign in](app/setup-4-signin.png) | ![Install](app/setup-5-install.png) | ![Keep data](app/setup-6-persist.png) |
| Sign in | Install | Keep data |

| States | | |
| --- | --- | --- |
| ![Lists](app/lists.png) | ![Empty list](app/list-empty.png) | ![Offline](app/lists-offline.png) |
| Lists | Empty list | Offline, changes pending |
| ![Conflict note](app/task-conflict.png) | ![Logout](app/logout-pending.png) | |
| Conflict note and notice | Logout with pending changes | |
