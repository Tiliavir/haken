// Package static serves the embedded app with strict security headers.
package static

import (
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strings"
)

// CSP is the policy for every response. The app loads only its own files and
// talks only to its own origin.
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
	"manifest-src 'self'; worker-src 'self'; form-action 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'"

// SecurityHeaders sets the headers shared by all responses.
func SecurityHeaders(h http.Header) {
	h.Set("Content-Security-Policy", CSP)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Cross-Origin-Opener-Policy", "same-origin")
	h.Set("Cross-Origin-Resource-Policy", "same-origin")
	h.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()")
	h.Set("X-Frame-Options", "DENY")
}

var types = map[string]string{
	".html":        "text/html; charset=utf-8",
	".js":          "text/javascript; charset=utf-8",
	".css":         "text/css; charset=utf-8",
	".json":        "application/json; charset=utf-8",
	".webmanifest": "application/manifest+json",
	".svg":         "image/svg+xml",
	".png":         "image/png",
	".ico":         "image/x-icon",
	".txt":         "text/plain; charset=utf-8",
}

// Handler serves files from fsys. Only GET and HEAD; "/" maps to index.html;
// unknown paths are 404 (no SPA fallback: routes live in the URL fragment).
func Handler(fsys fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		SecurityHeaders(w.Header())
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if name == "" {
			name = "index.html"
		}
		if !fs.ValidPath(name) || strings.HasPrefix(path.Base(name), ".") {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ext := path.Ext(name)
		ct, ok := types[ext]
		if !ok {
			ct = mime.TypeByExtension(ext)
		}
		if ct == "" {
			ct = "application/octet-stream"
		}
		w.Header().Set("Content-Type", ct)
		// The service worker keeps the app usable offline; the network copy is always revalidated.
		w.Header().Set("Cache-Control", "no-cache")
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusOK)
			return
		}
		_, _ = w.Write(data)
	})
}
