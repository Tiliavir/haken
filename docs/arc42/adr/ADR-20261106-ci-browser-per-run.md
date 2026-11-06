# ADR-20261106: CI browser per run, not in the image

Status: Proposed

Partly supersedes [ADR-20261105-ci-image](ADR-20261105-ci-image.md): the image no longer provides the browser.

## Decision

- The CI image keeps Chromium's system libraries but no browser.
- `tools/ci.sh` installs Chromium for the Playwright version in `package-lock.json`. `check.yml` caches it per version (`actions/cache`).
- A CI run downloads npm packages and, on a cache miss, the browser.

## Why

- Browsers in the image tie the image to `@playwright/test`: every Playwright update needed a new image and digest in the same change, which Dependabot cannot do, so its updates failed.
- The browser comes from Playwright's CDN, not the slow Ubuntu mirror: ~10–20 s on a cache miss, a few seconds from the cache.
- If a new Playwright version needs a system library the image lacks, the run fails with a clear error and the image gets rebuilt.
