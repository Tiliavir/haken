package proxy

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/Tiliavir/haken/gateway/internal/session"
)

func TestAllowedPath(t *testing.T) {
	cases := map[string]bool{
		"/dav/alice":            true,
		"/dav/alice/":           true,
		"/dav/alice/list/x.ics": true,
		"/dav/alicex/":          false,
		"/dav/bob/":             false,
		"/dav/":                 false,
		"/dav/alice/../bob/":    false,
		"/dav/alice//x":         false,
		"/dav/alice/./x":        false,
	}
	for p, want := range cases {
		if got := allowedPath(p, "alice"); got != want {
			t.Errorf("%s: got %v want %v", p, got, want)
		}
	}
}

func TestProxyInjectsSessionAndStripsCookies(t *testing.T) {
	var seen *http.Request
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PROPFIND" && r.URL.Path == "/alice/" && r.Header.Get("Depth") == "0" {
			w.WriteHeader(http.StatusMultiStatus)
			return
		}
		seen = r.Clone(r.Context())
		w.Header().Set("Set-Cookie", "radicale=1")
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL)
	sessions := session.New(u, time.Hour, session.NewLimiter(5, time.Minute))
	login := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user":"alice","password":"secret"}`))
	login.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	sessions.ServeHTTP(rec, login)
	cookie := rec.Result().Cookies()[0]

	h := New(u, sessions)
	req := httptest.NewRequest(http.MethodGet, "/dav/alice/list/x.ics?leak=1", nil)
	req.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	if seen.URL.Path != "/alice/list/x.ics" || seen.URL.RawQuery != "" {
		t.Errorf("upstream path %q query %q", seen.URL.Path, seen.URL.RawQuery)
	}
	if user, pass, ok := seen.BasicAuth(); !ok || user != "alice" || pass != "secret" {
		t.Error("basic auth not injected")
	}
	if seen.Header.Get("Cookie") != "" {
		t.Error("cookie leaked to Radicale")
	}
	if seen.Header.Get("X-Script-Name") != "/dav" {
		t.Error("X-Script-Name missing")
	}
	if rec.Header().Get("Set-Cookie") != "" {
		t.Error("Radicale cookie passed to the client")
	}

	other := httptest.NewRequest(http.MethodGet, "/dav/bob/", nil)
	other.AddCookie(cookie)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, other)
	if rec.Code != http.StatusForbidden {
		t.Errorf("foreign path: %d", rec.Code)
	}

	anon := httptest.NewRequest(http.MethodGet, "/dav/alice/", nil)
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, anon)
	if rec.Code != http.StatusUnauthorized || rec.Header().Get("WWW-Authenticate") == "" {
		t.Errorf("anonymous: %d", rec.Code)
	}
}

func TestMethodAllowlist(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()
	u, _ := url.Parse(upstream.URL)
	h := New(u, session.New(u, time.Hour, session.NewLimiter(5, time.Minute)))
	cases := map[string]int{
		http.MethodGet:     http.StatusOK,
		http.MethodHead:    http.StatusOK,
		http.MethodOptions: http.StatusOK,
		http.MethodPut:     http.StatusOK,
		http.MethodDelete:  http.StatusOK,
		"PROPFIND":         http.StatusOK,
		"PROPPATCH":        http.StatusOK,
		"REPORT":           http.StatusOK,
		"MKCALENDAR":       http.StatusOK,
		"MKCOL":            http.StatusOK,
		"MOVE":             http.StatusMethodNotAllowed,
		"COPY":             http.StatusMethodNotAllowed,
		"LOCK":             http.StatusMethodNotAllowed,
		"UNLOCK":           http.StatusMethodNotAllowed,
		"ACL":              http.StatusMethodNotAllowed,
		http.MethodPost:    http.StatusMethodNotAllowed,
		http.MethodPatch:   http.StatusMethodNotAllowed,
		http.MethodTrace:   http.StatusMethodNotAllowed,
		"propfind":         http.StatusMethodNotAllowed,
	}
	for method, want := range cases {
		req := httptest.NewRequest(method, "/dav/alice/list/", nil)
		req.SetBasicAuth("alice", "secret")
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s: got %d want %d", method, rec.Code, want)
		}
	}
}
