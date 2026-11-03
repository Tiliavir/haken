# ADR-20261103: Theming with system dark mode, override and custom accent

Status: Accepted

## Decision

- Colours are CSS custom properties in one stylesheet. Each token is written as `light-dark(<light>, <dark>)`, and `:root { color-scheme: light dark; }` makes the page follow the system setting.
- Setting "Appearance": System (default), Light or Dark. Light and Dark set `data-theme` on `<html>`, which the CSS maps to `color-scheme: light` or `color-scheme: dark`.
- Setting "Accent colour": a native `<input type="color">`, default `#1F4D45`, the brand colour of the [logo](../../../web/icons/README.md).
- Both settings are stored per device in IndexedDB and applied before the first render. They are not synced to CalDAV.
- From the chosen accent, `ui/theme.ts` derives:
  - one variant per scheme that reaches 4.5:1 contrast against that scheme's `--bg` and `--surface`, by adjusting lightness in OKLCH (default: `#1F4D45` light, `#618F86` dark);
  - a text colour for filled accent surfaces, black or white, whichever contrasts more.

  These are pure functions and are unit tested.
- The derived values are written to a constructed stylesheet (`CSSStyleSheet.replaceSync`, then `document.adoptedStyleSheets`). There are no inline styles, and the setup is CSP-compatible.
- `accent-color` is set from the accent, so native checkboxes, radios and colour pickers match it.
- The logo and app icons always use the brand colours (`#1F4D45` mark on `#F4EFE6` tile); they do not follow the accent.
- Before the app runs, the manifest's brand colours colour the splash screen (`background_color #F4EFE6`) and the title bar (`theme_color #1F4D45`, also the initial `<meta name="theme-color">`). At startup `ui/theme.ts` sets `<meta name="theme-color">` to the active scheme's `--bg`, so the installed PWA's title bar matches the page.

## Why

- `light-dark()` together with `color-scheme` is the platform mechanism for this: one token list, no second stylesheet, and native controls and scrollbars switch with it.
- Any colour a user picks stays readable, so accessibility does not depend on their choice.
- A constructed stylesheet keeps the no-inline-CSS rule without weakening the CSP.
- The manifest is static and cannot know the scheme; brand colours are the neutral choice until the page takes over.
