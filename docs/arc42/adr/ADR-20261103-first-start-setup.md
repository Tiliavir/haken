# ADR-20261103: First start and setup

Status: Accepted

## Decision

- **Explicit state, not inference.** A meta database `haken` (stores `accounts`, `settings`) records the setup step and `setup = done`. Setup runs only if no account exists and `setup ≠ done`. The absence of a database alone is never used as the signal.
- **Resumable.** Each completed step is written before the next one is shown. Reload, crash or switching to the installed app (where it shares the tab's storage) continues at that step.
- **Setup never deletes or overwrites data.** Existing accounts skip it; import adds, the initial pull writes into an empty account database only.
- **Modes come from `config.json` `accounts`**, so the demo build offers only the local mode and the setup has one code path.
- **Server unreachable during setup:** offer a local account that is connected later ([browser-only mode](ADR-20261103-browser-only-mode.md)); never a half-configured server account.
- **Separate app storage: install before choosing the mode.** On iOS and iPadOS (any browser) and in macOS Safari the installed web app does not see the tab's data. Installing is still optional; continuing in the tab is allowed.
- **Persistent storage is requested last**, by a button, after the install step.

## Why

- A missing database also means "browser cleared storage". Treating that as a normal first visit without a hint would hide data loss; the welcome screen names it and the restore paths.
- Setting up in the tab and then installing would leave the user with an empty app and an orphaned local account in the tab, which Safari evicts after 7 days unused. Apple documents that Mac web apps share no cookies or website data with Safari.
- `persist()` needs a user gesture in some browsers and is granted more often for installed apps.
