package main

import "embed"

// embedded holds the built app; `make gateway` copies dist/web into
// internal/static/dist and then into this package's dist directory.
//
//go:embed all:dist
var embedded embed.FS
