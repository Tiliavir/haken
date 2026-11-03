#!/bin/sh
# Renders the PNG and ICO app icons from the SVG sources in web/icons/.
# Requires rsvg-convert (librsvg) and ImageMagick. Output is committed;
# re-run only after changing an SVG source.
set -eu

cd "$(dirname "$0")/../web/icons"

png() { rsvg-convert --width "$2" --height "$2" --output "$3" "$1"; }

png icon.svg 192 icon-192.png
png icon.svg 512 icon-512.png
png icon-maskable.svg 192 icon-maskable-192.png
png icon-maskable.svg 512 icon-maskable-512.png
png icon-full.svg 180 apple-touch-icon.png

png icon.svg 16 favicon-16.tmp.png
png icon.svg 32 favicon-32.tmp.png
png icon.svg 48 favicon-48.tmp.png
convert favicon-16.tmp.png favicon-32.tmp.png favicon-48.tmp.png favicon.ico
rm favicon-16.tmp.png favicon-32.tmp.png favicon-48.tmp.png
