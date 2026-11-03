# ADR-20261103: Frontend in TypeScript on platform APIs, no framework

Status: Accepted

## Decision

- TypeScript 7 (native compiler), strictest flags (`strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- UI as Custom Elements; state changes re-render explicitly. No framework, no virtual DOM.
- `tsc` emits ES modules; the browser loads them natively. No bundler.
- Runtime dependency: `ical.js` (Mozilla, used by Thunderbird) only, vendored and pinned.
- Dev tools: `typescript`, plus those in [quality gates](ADR-20261103-build-time-quality-gates.md). Nothing else without a new ADR.
- Drag and drop: own Pointer Events code (native HTML5 DnD fails on touch).

## Why

- Every behaviour is visible in our code; no compiler or framework magic.
- Web standards outlive frameworks; nothing to upgrade but TypeScript.
- iCalendar parsing is the biggest data-loss risk; `ical.js` round-trips unknown properties and is mature. Writing our own is not worth the risk.
