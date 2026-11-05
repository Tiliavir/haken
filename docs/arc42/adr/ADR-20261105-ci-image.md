# ADR-20261105: Prebuilt CI image

Status: Proposed

Supersedes the CI image in [ADR-20261105-implementation-baseline](ADR-20261105-implementation-baseline.md) (*Build*).

## Decision

- CI runs `tools/ci.sh` in `ghcr.io/tiliavir/haken-ci`, built from `tools/ci.Dockerfile`: the pinned Playwright image plus Java (vnu), Radicale, make, Go (`GOTOOLCHAIN=go1.24.7`) and staticcheck.
- `ci-image.yml` builds and pushes it when the Dockerfile changes; `check.yml` pins it by digest. `make check-container` uses the same image.
- A CI run downloads only npm packages.

## Why

- Installing the tools in every run took ~1.5 min and, when the Ubuntu mirror was slow, 30–44 min. The checks themselves take ~4 min.
- A digest-pinned image keeps local and CI runs identical (ADR-20261103-build-time-quality-gates).
