# CI image: the Playwright image (Node, browsers) plus Java (vnu), Radicale, make, Go and
# staticcheck, so CI runs download nothing but npm packages. Built by
# .github/workflows/ci-image.yml; check.yml pins it by digest. Update both together.
# Runs as root on purpose (Sonar hotspot reviewed as safe): GitHub container jobs need root
# to write the runner-owned workspace; the image runs only throwaway CI jobs, never deployed.
# mcr.microsoft.com/playwright:v1.64.1-noble (same version as @playwright/test)
FROM mcr.microsoft.com/playwright@sha256:2f05f8a734509a7b3f26a912639488ee08f58a7b292d14d62271bcff9038768f

# Go 1.22 from Ubuntu only bootstraps the pinned toolchain: GOTOOLCHAIN downloads it and
# verifies it against the Go checksum database. A fixed GOPATH keeps it independent of HOME.
ENV GOTOOLCHAIN=go1.24.7 GOPATH=/go PATH=/go/bin:$PATH

RUN apt-get update \
 && apt-get install -y --no-install-recommends openjdk-17-jre-headless python3-pip make golang-go ca-certificates git \
 && rm -rf /var/lib/apt/lists/* \
 && pip install --no-cache-dir --break-system-packages --only-binary :all: radicale==3.9.0 \
 && go version \
 && go install honnef.co/go/tools/cmd/staticcheck@2025.1.1 \
 && rm -rf /root/.cache
