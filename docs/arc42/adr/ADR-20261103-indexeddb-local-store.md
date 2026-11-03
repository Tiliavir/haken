# ADR-20261103: Local store is IndexedDB, not localStorage

Status: Accepted

## Decision

All tasks, the sync outbox and attachments live in IndexedDB, accessed through a small own wrapper (no library). The app requests `navigator.storage.persist()` on first start.

## Why

| | `localStorage` | IndexedDB |
| --- | --- | --- |
| Size | ~5 MB per origin | Large share of free disk |
| Atomic multi-key write | No | Yes (transaction) |
| Binary data (attachments) | No (base64 only) | Yes (`Blob`) |
| Usable in Service Worker | No | Yes |
| Blocks UI thread | Yes | No |

The outbox must be written in the same atomic step as the edit; only IndexedDB guarantees that. Both are W3C standards, so neither adds a dependency.
