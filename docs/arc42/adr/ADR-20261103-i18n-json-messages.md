# ADR-20261103: Internationalisation with flat JSON message files

Status: Proposed

## Decision

- Bundled locales: `en`, `de`, `fr`, `es`, `it`. `en` is the reference locale.
- One file per locale, `web/locales/<tag>.json` (BCP 47 tag), a flat object of key → string:

  ```json
  {
    "list.add": "Add a task",
    "list.open.one": "{count} open task",
    "list.open.other": "{count} open tasks",
    "task.due": "Due {date}"
  }
  ```

- `web/locales/index.json` lists the available locales by native name: `{"en": "English", "de": "Deutsch", "fr": "Français", "es": "Español", "it": "Italiano"}`. Adding a language means adding one JSON file and one line here, with no code change.
- Placeholders are written `{name}` and are substituted as plain text. Plurals use one key suffix per CLDR category (`.zero` `.one` `.two` `.few` `.many` `.other`), selected with `Intl.PluralRules`. No ICU MessageFormat and no library.
- Dates, numbers and the sorting of names use `Intl.DateTimeFormat`, `Intl.NumberFormat` and `Intl.Collator` with the active locale. Message files never contain formats.
- The active locale is resolved in this order: the per-device setting (stored in IndexedDB), then the first match in `navigator.languages` (exact tag first, then language only), then `en`. The result is set on `<html lang>`.
- Loading: the active locale and `en` are fetched same-origin before the first render. The service worker precaches every bundled locale with the app shell, so switching language works offline.
- A missing key falls back to `en` at runtime. A [quality gate](ADR-20261103-build-time-quality-gates.md) fails the build if a bundled locale is missing keys, has extra keys, or uses different placeholders from `en` for a key, or if `index.json` and the files in `web/locales/` disagree.
- Keys are typed: `t()` accepts only `keyof typeof import("../locales/en.json")`. This is a type-only import that `tsc` erases, so a typo in a key fails compilation.
- Messages are inserted with `textContent` only, never as HTML.
- User content (task titles, list names, labels) is never translated.
- `ui/i18n.ts` holds `t()`, locale negotiation and loading. Only `ui/` and `main.ts` use it.

## Why

- A flat JSON file is the simplest format a contributor can edit without tooling.
- `Intl` already provides plural rules, date and number formats and collation for every language, so a library would only duplicate the platform.
- Build-time key checks plus the `en` fallback mean an incomplete translation never shows a raw key and never breaks the UI.
- Inserting with `textContent` keeps a contributed translation from injecting markup.
