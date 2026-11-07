# ADR-20261107: Offer updates, show what's new

Status: Accepted

## Decision

- A new version is never loaded into a running page. When an updated service worker takes over a page that already had one (`controllerchange`), the page shows a bar *A new version of Haken is ready.* with *Reload*; it stays until reloaded. Reload saves typed text first.
- The build turns the released sections of `CHANGELOG.md` into `changelog.json` (plain text, in the app shell, so it works offline). The build fails if the current version has no section.
- The setting `seenVersion` holds the version whose changes were shown. On start with a different version and a finished setup, a dialog *What's new* lists every version after `seenVersion` up to the current one, newest first; unknown `seenVersion` (installed before this) shows the current version only. It is shown once. A first setup only stores the version.
- The changelog text stays English (as `CHANGELOG.md`); the dialog's own labels are translated.

## Why

- Reloading on its own could interrupt typing or a drag; the user decides when.
- One source for release notes: what is released is what the app tells.
- Translating every changelog entry into six languages costs more than it gives for a personal app.

## Consequences

- An older version that finds `seenVersion` in its settings rejects it as unknown; going back to an older version is not supported.
