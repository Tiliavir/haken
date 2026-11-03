# ADR-20261103: First start and setup

Status: Accepted

## Decision

- **Explicit state, not inference.** A meta database `haken` (stores `accounts`, `settings`) records the active account and the current setup step. Setup runs when no account is active. The absence of a database alone is never used as the signal.
- **Resumable.** Each completed step is written before the next one is shown. Reload, crash or switching to the installed app (where it shares the tab's storage) continues at that step.
- **Setup never deletes or overwrites data.** Import adds or replaces only after confirmation ([browser-only mode](ADR-20261103-browser-only-mode.md)); the initial pull writes into an empty account database only.
- **Default list "Haken".** Created only if the server has no `VTODO` collection, and for a new local account. The name is not translated.
- **Modes come from `config.json` `accounts`**, so the demo build offers only the local mode and the setup has one code path.
- **Server unreachable during setup:** offer to start with a local account, with the warning that moving it to the server later needs export and import; never a half-configured server account.
- **Separate app storage: install before choosing the mode.** On iOS and iPadOS (any browser) and in macOS Safari the installed web app does not see the tab's data. Installing is still optional; continuing in the tab is allowed.
- **Install and persistent storage are offered once**, in setup, persistent storage last and by a button. They are not repeated in Settings; logging out runs setup again.
- **Logout** returns to step 4 ([Auth](ADR-20261103-authentication.md)).

## Why

- A missing database also means "browser cleared storage". Treating that as a normal first visit without a hint would hide data loss; the welcome screen names it and the restore paths.
- Setting up in the tab and then installing would leave the user with an empty app and an orphaned local account in the tab, which Safari evicts after 7 days unused. Apple documents that Mac web apps share no cookies or website data with Safari.
- `persist()` needs a user gesture in some browsers and is granted more often for installed apps.
- One untranslated name means devices with different languages never create two default lists.
