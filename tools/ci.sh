#!/bin/sh
# Everything CI runs, inside the CI image (tools/ci.Dockerfile, pinned in .github/workflows/check.yml).
# CI runs it on the checkout; `make check-container` runs it on a copy of HEAD.
set -eu

npm ci --ignore-scripts
make check
(cd gateway && staticcheck ./...)
