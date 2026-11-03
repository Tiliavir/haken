# App icons

The mark is a checkmark drawn as a fish hook: an eye at the top of the long
stroke, a small concave barb at the tip of the short stroke. Colours:
`#1F4D45` (mark, theme) on `#F4EFE6` (tile, background).

| File | Use |
| --- | --- |
| `icon.svg` | Master; rounded tile. Favicon and manifest `any` |
| `icon-full.svg` | Square tile, source for `apple-touch-icon.png` (iOS rounds itself) |
| `icon-maskable.svg` | Square tile, mark scaled to the maskable safe zone (inner 80 % circle) |
| `icon-{192,512}.png` | Manifest `any` |
| `icon-maskable-{192,512}.png` | Manifest `maskable` |
| `apple-touch-icon.png` | 180 × 180, iOS home screen |
| `favicon.ico` | 16/32/48, legacy browsers |

The SVGs are the sources. After changing one, run `tools/render-icons.sh`
(needs `rsvg-convert` and ImageMagick) and commit the output.

`<head>` of `index.html`:

```html
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" href="icons/favicon.ico" sizes="48x48">
<link rel="icon" href="icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="theme-color" content="#1F4D45">
```

The `theme-color` value is only the initial one; at startup the app replaces it
with the page background of the active scheme ([Theming](../../docs/arc42/adr/ADR-20261103-theming.md)).

In the app the logo is `icon.svg` shown as an image; it keeps the brand colours
and does not follow the accent.
