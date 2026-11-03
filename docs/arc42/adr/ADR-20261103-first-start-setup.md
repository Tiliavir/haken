# ADR-20261103: First start and setup

Status: Proposed

## Decision

- **Explicit state, not inference.** A meta database `haken` (stores `accounts`, `settings`) records the setup step and `setup = done`. Setup runs only if no account exists and `setup ≠ done`. The absence of a database alone is never used as the signal.
- **Resumable.** Each completed step is written before the next one is shown. Reload, crash or switching to the installed app continues at that step.
- **Setup never deletes or overwrites data.** Existing accounts skip it; import adds, the initial pull writes into an empty account database only.
- **Modes come from `config.json` `accounts`**, so the demo build offers only the local mode and the setup has one code path.
- **Server unreachable during setup:** offer a local account that is connected later ([browser-only mode](ADR-20261103-browser-only-mode.md)); never a half-configured server account.
- **iOS: install before choosing the mode.** The home-screen app does not see data stored in the Safari tab.
- **Persistent storage is requested last**, by a button, after the install step.

## Why

- A missing database also means "browser cleared storage". Treating that as a normal first visit without a hint would hide data loss; the welcome screen names it and the restore paths.
- Setting up on iOS in Safari and then installing would leave the user with an empty app and an orphaned local account, which Safari evicts after 7 days unused.
- `persist()` needs a user gesture in some browsers and is granted more often for installed apps.
