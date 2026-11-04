# haken — build and quality gates. `make check` runs everything CI runs.
SHELL := /bin/sh
NPX := npx --no-install
CONFIG ?= web/config.json

.PHONY: build build-demo test test-unit test-go lint fmt validate e2e check run clean gateway

build:
	rm -rf dist
	$(NPX) tsc -p tsconfig.json
	$(NPX) tsc -p tsconfig.sw.json
	node tools/build.mjs --config $(CONFIG)

build-demo:
	$(MAKE) build CONFIG=web/config/demo.json

test-unit: build
	node --test "dist/tests/unit/*.test.js"

lint:
	$(NPX) biome ci .
	cd gateway && test -z "$$(gofmt -l .)" && go vet ./...

fmt:
	$(NPX) biome check --write .
	cd gateway && gofmt -w .

validate: build
	java -jar node_modules/vnu-jar/build/dist/vnu.jar --skip-non-html --also-check-css --also-check-svg \
		dist/web/index.html dist/web/styles dist/web/icons

gateway: build
	rm -rf gateway/internal/static/dist && mkdir -p gateway/internal/static/dist
	cp -r dist/web/. gateway/internal/static/dist/
	cd gateway && CGO_ENABLED=0 go build -trimpath -o ../dist/haken ./cmd/haken

test-go: gateway
	cd gateway && go test ./...

e2e: gateway
	$(NPX) playwright test

check: lint test-unit validate test-go e2e

# Local development: Radicale (pip) on :5232, gateway on :8080.
run: gateway
	tools/dev-run.sh

clean:
	rm -rf dist gateway/internal/static/dist test-results
