#!/bin/sh
# Everything CI runs, inside the CI image (tools/ci.Dockerfile, pinned in .github/workflows/check.yml).
# CI runs it on the checkout; `make check-container` runs it on a copy of HEAD.
set -eu

npm ci --ignore-scripts
# The browser of the locked Playwright version; check.yml caches it per version.
npx --no-install playwright install --no-shell chromium
make check
(cd gateway && staticcheck ./...)
