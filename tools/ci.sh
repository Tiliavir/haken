#!/bin/sh
# Everything CI runs, inside the pinned Playwright image (see .github/workflows/ci.yml).
# CI runs it on the checkout; `make check-container` runs it on a copy of HEAD.
set -eu

# Java (vnu), pip (Radicale), make; Go 1.22 from Ubuntu only bootstraps the pinned
# toolchain: GOTOOLCHAIN downloads it and verifies it against the Go checksum database.
apt-get update
apt-get install -y --no-install-recommends openjdk-17-jre-headless python3-pip make golang-go ca-certificates git
pip install --break-system-packages radicale==3.9.0 # same as deploy/compose.yml
export GOTOOLCHAIN=go1.24.7
go version
go install honnef.co/go/tools/cmd/staticcheck@2025.1.1

npm ci
make check
(cd gateway && "$(go env GOPATH)/bin/staticcheck" ./...)
