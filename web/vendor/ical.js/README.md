# ical.js (vendored)

| | |
| --- | --- |
| Upstream | <https://github.com/kewisch/ical.js> |
| Version | 2.2.1 (npm `ical.js@2.2.1`) |
| Files | `dist/ical.js` → `ical.js`, `dist/types/*.d.ts` → `types/` |
| SHA-256 of `ical.js` | `396c1349c899974b1048460e3c7495ec394ff1a86941ab5bf6291b272b8d53c2` |
| License | MPL-2.0 ([`LICENSE`](LICENSE)); unmodified |

`ical.d.ts` is ours: it re-exports the upstream types for the relative import
in `web/src/domain/`.

Update: `npm pack ical.js@<version>`, copy the files above, update this table,
run `make check`. `tests/unit/vendor.test.ts` fails if the hash here and the
file disagree.
