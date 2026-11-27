# ADR-20261127: Property tests and fuzzing

Status: Accepted

## Decision

- **TypeScript:** property tests on `node:test` (`tests/unit/*.property.test.ts`) with an own seeded generator (`tests/unit/property.ts`, mulberry32). No library.
  - Fixed seed in `make check`: deterministic, a few hundred runs per property.
  - `HAKEN_SEED` / `HAKEN_RUNS` override it; a failure prints the seed that reproduces it alone.
  - Targets: parser (mutated fixtures), merge, `.ics` import/export, manual order.
- **Go:** native fuzzing (`go test -fuzz`) for the `/dav` path check; seeds are `f.Add` cases and run with every `go test`.
- `make fuzz` runs both with random seeds or for a fixed time. Not a gate.
- A failure found this way is fixed and gets a plain unit test (or an `invalid-*` fixture).

## Why

- Merge, parsing and the path check guard against data loss and data leaks; examples cover only the cases someone thought of.
- A generator for structured inputs (edits, labels, orders) is ~70 lines; a library would add a dependency mainly for shrinking. Revisit if minimal failing inputs are missed.
- Go's fuzzer is in the standard toolchain, so `go.mod` stays without `require`.
- Random runs outside the gate keep `make check` fast and reproducible.
