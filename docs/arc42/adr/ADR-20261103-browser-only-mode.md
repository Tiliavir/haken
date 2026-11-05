# ADR-20261103: Browser-only mode without a server

Status: Accepted; partly superseded by [ADR-20261105-implementation-baseline](ADR-20261105-implementation-baseline.md) (no outbox for local accounts)

## Decision

- A "Local" account works without any backend: data lives in IndexedDB only, the outbox is never drained.
- The same static build runs from any static host (or `localhost`); no gateway required.
- Backup by `.ics` export/import.
- **No conversion to a server account.** Moving to a server means: export `.ics`, log out (deletes the local data), sign in, import. The UI warns about this when a local account is created.
- **Import:** a task whose `UID` already exists is the same task; the import replaces it. Before importing, the app shows how many tasks will be replaced and imports only on confirmation. Replacements are ordinary edits through the outbox (`If-Match`).
- The UI shows clearly that local data has no server copy.

### Demo on GitHub Pages

- A GitHub Actions job deploys the static build to Pages after all quality gates pass.
- The build reads an explicit `config.json`; the demo sets `"accounts": ["local"]`, so no server login is offered.
- All URLs are relative (manifest `start_url`, `scope`, service worker scope) so the app runs under `/haken/`.
- Pages cannot set headers: the CSP is a `<meta http-equiv>` in `index.html` (same policy, minus `frame-ancestors`).
- `<user>.github.io` is one origin shared by all of the owner's Pages sites; they could read each other's IndexedDB. The demo is labelled "demo, do not store real data". A custom domain gives the demo its own origin.

## Why

- Local-first already makes the server optional; the mode costs one account type, no new code paths in the store.
- Account databases are keyed by server + user; an in-place conversion would change that identity and has to merge with tasks already on the server. Export and import reuse existing paths and keep the user in control.
- `UID`s are globally unique (UUIDs for tasks haken creates), so an equal `UID` means the same task.
- Browser storage can be evicted; export and `navigator.storage.persist()` mitigate, the warning makes the risk explicit.
