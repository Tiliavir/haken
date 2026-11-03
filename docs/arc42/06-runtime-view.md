# 6. Runtime View

## First start and setup

Runs when the meta database has no completed setup and no account
([ADR](adr/ADR-20261103-first-start-setup.md)). Every step is stored; a reload
resumes at the same step.

Switching from the browser tab to the installed app is optional. Whether the
app sees the tab's data depends on the platform:

| Platform | Tab and app share storage | Switching to the app |
| --- | --- | --- |
| Chromium (Chrome, Edge), Firefox Android, Samsung Internet | Yes | Resumes at the same step, same data and session |
| iOS, iPadOS (any browser), macOS Safari ("Add to Dock") | No | App starts with an empty store: setup from step 1, new sign-in |

The second group is called *separate app storage* below.

```mermaid
flowchart TD
  start([App start]) --> idb{IndexedDB usable?}
  idb -- no --> blocked[Blocker: storage unavailable<br/>private window or blocked by browser]
  idb -- yes --> done{Account exists or<br/>setup = done?}
  done -- yes --> app([Task lists])
  done -- no --> resume{Stored step?}
  resume -- yes --> at[Continue at stored step]
  resume -- no --> welcome[1 Welcome]
  welcome --> intro[2 Intro, 3 screens, skippable]
  intro --> ios{Separate app storage<br/>and not standalone?}
  ios -- yes --> iosinst[3 Install first:<br/>Add to Home Screen / Dock]
  iosinst -- installed --> handoff([Continue in the installed app])
  iosinst -- continue in browser --> mode
  ios -- no --> mode{4 Storage mode<br/>offered by config.json}
  mode -- server --> login[5a Sign in]
  login -- 401 / 429 --> login
  login -- unreachable --> offline{Start locally,<br/>connect later?}
  offline -- retry --> login
  offline -- yes --> local
  login -- ok --> lists[Discover task lists;<br/>create 'Tasks' if none]
  lists --> pull[Initial pull with progress]
  mode -- local --> local[5b Local account:<br/>start empty or import .ics]
  pull --> inst
  local --> inst{Installable and<br/>not standalone?}
  inst -- yes --> install[6 Offer install]
  inst -- no --> persist
  install --> persist[7 Request persistent storage]
  persist --> finish[setup = done]
  finish --> app
```

| Step | Content | Leave | Failure |
| --- | --- | --- | --- |
| 1 Welcome | Name, one sentence. Secondary action "Used haken here before?": browser storage may have been cleared; signing in restores from the server, a local account only from `.ics` | Start | — |
| 2 Intro | Offline first, sync, order by drag and drop. Original illustrations | Next, Skip | — |
| 3 Install first (separate app storage only) | Data set up in this tab stays in the tab; Safari clears a site's storage after 7 days unused. Detected in one tested function from the user agent, since no feature test exists | Installed, Continue in browser | Continue in browser: server mode loses nothing (app signs in and pulls; the tab's outbox syncs when the tab is used again). Local mode: tab and app are separate stores, transfer only via `.ics` |
| 4 Storage mode | "Sync with my server" or "Only on this device". Only the modes in `config.json` `accounts`; a single mode skips the step | Choice, Back | — |
| 5a Sign in | Username, password (`autocomplete` so password managers work) to `POST /api/session`. The app never stores the password | Sign in, Back | 401: message, retry. 429: wait time. Unreachable: offer local start |
| 5a Lists | `PROPFIND` calendar home, list `VTODO` collections. None: `MKCALENDAR` "Tasks" | automatic | Error: retry, back |
| 5a Pull | Into the account database; sync token stored only after completion, so a resumed pull starts over safely | automatic | Offline: resumes at next start |
| 5b Local | Create account database; warn "no server copy, export regularly". Optional `.ics` import. Demo build also shows "demo, do not store real data" | Start empty, Import | Import error: shows invalid items, imports the rest only on confirmation |
| 6 Install | Chromium: own button calling the saved `beforeinstallprompt`. Others: short instruction. Skipped if not possible | Install, Later | Dismissed: offered again from settings |
| 7 Persist | Button calling `navigator.storage.persist()` (user gesture; after install it is usually granted) | Allow, Later | Denied: hint and export reminder, no blocker |

Adding an account later from the settings runs steps 4–5.
