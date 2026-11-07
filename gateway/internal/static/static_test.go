package static

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestServesWithHeaders(t *testing.T) {
	fsys := fstest.MapFS{
		"index.html":           {Data: []byte("<!doctype html>")},
		"manifest.webmanifest": {Data: []byte("{}")},
		".hidden":              {Data: []byte("x")},
	}
	h := Handler(fsys)
	for path, want := range map[string]int{"/": 200, "/manifest.webmanifest": 200, "/missing": 404, "/.hidden": 404, "/../etc/passwd": 404} {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != want {
			t.Errorf("%s: %d", path, rec.Code)
		}
		if rec.Header().Get("Content-Security-Policy") != CSP {
			t.Errorf("%s: CSP missing", path)
		}
		if got := rec.Header().Get("Referrer-Policy"); got != "same-origin" {
			t.Errorf("%s: Referrer-Policy %q", path, got)
		}
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/manifest.webmanifest", nil))
	if rec.Header().Get("Content-Type") != "application/manifest+json" {
		t.Errorf("manifest type %q", rec.Header().Get("Content-Type"))
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/", nil))
	if rec.Code != http.StatusMethodNotAllowed {
		t.Errorf("POST: %d", rec.Code)
	}
}
