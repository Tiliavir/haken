# ADR-20261106: Release from main, CI creates the tag

Status: Proposed

Partly supersedes [ADR-20261105-implementation-baseline](ADR-20261105-implementation-baseline.md): a release is no longer triggered by a pushed tag.

## Decision

- A push to `main` whose `package.json` version has no tag `vx.y.z` releases that version: full check, `ghcr.io/tiliavir/haken` (`x.y.z`, `latest`), then tag `vx.y.z` and GitHub release with the `CHANGELOG.md` section.
- A missing changelog section fails the release. Pushes whose version is already tagged release nothing.
- Release runs are serialised, so two quick merges cannot release the same version twice.

## Why

- Releasing is one reviewed pull request; no manual step can tag the wrong commit or a misnamed tag.
- Agent sessions can push branches but not tags.
