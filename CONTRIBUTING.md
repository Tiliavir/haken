# Contributing

Thanks for your interest! A few ground rules:

- **Data safety first.** Changes touching sync, storage or iCalendar handling
  need tests. See the non-negotiables in [CLAUDE.md](CLAUDE.md) — they apply
  to humans too.
- **No external runtime requests.** No CDNs, fonts, analytics or trackers.
- **Original work only.** haken is inspired by other to-do apps but must not
  copy their code, icons, assets or trademarks.
- **Never include real data** (server URLs, credentials, personal tasks) in
  code, tests, screenshots or issues.
- Keep pull requests small and focused; describe what and why.

By contributing, you agree that your contributions are licensed under the
project's [0BSD license](LICENSE).

## Releasing

In one pull request: set `version` in `package.json` (and `package-lock.json`,
via `npm version --no-git-tag-version <x.y.z>`) and rename *Unreleased* in
[CHANGELOG.md](CHANGELOG.md) to `## [x.y.z] - YYYY-MM-DD`. Merge it. The
release workflow sees the untagged version, runs the full check, publishes
`ghcr.io/tiliavir/haken:x.y.z` and `:latest`, and creates the tag `vx.y.z`
with a GitHub release of the changelog section. Do not push tags by hand.
