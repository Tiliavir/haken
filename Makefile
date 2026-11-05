# haken — build and quality gates. `make check` runs everything CI runs.
SHELL := /bin/sh
NPX := npx --no-install
CONFIG ?= web/config.json

.PHONY: build build-demo test test-unit test-browser test-go lint fmt validate e2e check check-container coverage run clean gateway

build:
	rm -rf dist
	$(NPX) tsc -p tsconfig.json
	$(NPX) tsc -p tsconfig.sw.json
	node tools/build.mjs --config $(CONFIG)

build-demo:
	$(MAKE) build CONFIG=web/config/demo.json

test-unit: build
	node --test "dist/tests/unit/*.test.js"

# Store and sync modules in the browser against a CalDAV stub (no servers).
test-browser: build
	$(NPX) playwright test -c playwright.browser.config.ts

lint:
	$(NPX) biome ci .
	$(NPX) tsc -p tsconfig.e2e.json
	cd gateway && test -z "$$(gofmt -l .)" && go vet ./...

fmt:
	$(NPX) biome check --write .
	cd gateway && gofmt -w .

validate: build
	java -jar node_modules/vnu-jar/build/dist/vnu.jar --skip-non-html --filterpattern ".*Content Security Policy.*" --also-check-css --also-check-svg \
		dist/web/index.html dist/web/styles dist/web/icons

gateway: build
	find gateway/cmd/haken/dist -mindepth 1 ! -name README -delete
	cp -r dist/web/. gateway/cmd/haken/dist/
	cd gateway && CGO_ENABLED=0 go build -trimpath -buildvcs=false -o ../dist/haken ./cmd/haken

test-go: gateway
	cd gateway && go test ./...

e2e: gateway
	$(NPX) playwright test

check: lint test-unit test-browser validate test-go e2e

# Coverage of unit (TypeScript, mapped to the sources) and gateway tests, as LCOV and Go profile.
coverage: gateway
	$(NPX) tsc -p tsconfig.json --sourceMap
	mkdir -p coverage
	node --enable-source-maps --test --experimental-test-coverage \
		--test-coverage-exclude='dist/web/vendor/**' --test-coverage-exclude='tests/**' \
		--test-reporter=dot --test-reporter-destination=stdout \
		--test-reporter=lcov --test-reporter-destination=coverage/lcov.info "dist/tests/unit/*.test.js"
	cd gateway && go test -coverprofile=../coverage/go.out ./...

# The CI run, locally: committed HEAD in the pinned CI image (needs Docker).
CI_IMAGE := $(shell sed -n 's/^ *container: *//p' .github/workflows/ci.yml)
check-container:
	git archive --format=tar HEAD | docker run --rm -i -e PLAYWRIGHT_CHANNEL=chromium $(CI_IMAGE) \
		sh -c 'mkdir /src && tar -x -C /src && cd /src && tools/ci.sh'

# Local development: Radicale (pip) on :5232, gateway on :8080.
run: gateway
	tools/dev-run.sh

clean:
	rm -rf dist test-results coverage && git checkout -- gateway/cmd/haken/dist
