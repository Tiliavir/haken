package proxy

import (
	"bufio"
	"bytes"
	"io"
	"net"
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

// signedIn returns a session manager and the cookie of alice's session. The
// login check runs against its own stub, so the upstream under test sees only
// proxied requests.
func signedIn(t *testing.T) (*session.Manager, *http.Cookie) {
	t.Helper()
	verify := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "PROPFIND" || r.URL.Path != "/alice/" || r.Header.Get("Depth") != "0" {
			t.Errorf("unexpected login check %s %s", r.Method, r.URL.Path)
		}
		w.WriteHeader(http.StatusMultiStatus)
	}))
	t.Cleanup(verify.Close)
	u, _ := url.Parse(verify.URL)
	sessions := session.New(u, time.Hour, session.NewLimiter(5, time.Minute))
	login := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user":"alice","password":"secret"}`))
	login.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	sessions.ServeHTTP(rec, login)
	cookies := rec.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("login: status %d, %d cookies", rec.Code, len(cookies))
	}
	return sessions, cookies[0]
}

// upstream starts a Radicale stand-in.
func upstream(t *testing.T, h http.HandlerFunc) *url.URL {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return u
}

func TestProxyInjectsSessionAndStripsCookies(t *testing.T) {
	var seen *http.Request
	sessions, cookie := signedIn(t)
	u := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		seen = r.Clone(r.Context())
		w.Header().Set("Set-Cookie", "radicale=1")
		w.WriteHeader(http.StatusOK)
	})

	h := New(u, sessions)
	req := httptest.NewRequest(http.MethodGet, "/dav/alice/list/x.ics?leak=1", nil)
	req.AddCookie(cookie)
	rec := httptest.NewRecorder()
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

}

// /dav serves only the haken app: no Basic auth, no challenge, no cross-site use.
func TestOnlySessionAccepted(t *testing.T) {
	reached := false
	sessions, cookie := signedIn(t)
	u := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		reached = true
		w.WriteHeader(http.StatusOK)
	})
	h := New(u, sessions)
	cases := map[string]struct {
		prepare func(*http.Request)
		want    int
	}{
		"anonymous":            {func(*http.Request) {}, http.StatusUnauthorized},
		"basic auth":           {func(r *http.Request) { r.SetBasicAuth("alice", "secret") }, http.StatusUnauthorized},
		"bearer":               {func(r *http.Request) { r.Header.Set("Authorization", "Bearer x") }, http.StatusUnauthorized},
		"session + basic auth": {func(r *http.Request) { r.AddCookie(cookie); r.SetBasicAuth("alice", "secret") }, http.StatusUnauthorized},
		"session cross-site":   {func(r *http.Request) { r.AddCookie(cookie); r.Header.Set("Sec-Fetch-Site", "cross-site") }, http.StatusForbidden},
		"session":              {func(r *http.Request) { r.AddCookie(cookie) }, http.StatusOK},
	}
	for name, c := range cases {
		reached = false
		req := httptest.NewRequest("PROPFIND", "/dav/alice/", nil)
		c.prepare(req)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != c.want || rec.Header().Get("WWW-Authenticate") != "" || reached != (c.want == http.StatusOK) {
			t.Errorf("%s: status %d, challenge %q, reached Radicale %v", name, rec.Code, rec.Header().Get("WWW-Authenticate"), reached)
		}
	}
}

// Radicale answers 413 on Content-Length alone and closes the connection
// without reading the body. The proxy must pass that 413 on, never a 502.
func TestEarlyRejectionOfLargeBody(t *testing.T) {
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			br := bufio.NewReader(conn)
			for {
				line, err := br.ReadString('\n')
				if err != nil || line == "\r\n" {
					break
				}
			}
			_, _ = conn.Write([]byte("HTTP/1.0 413 Request Entity Too Large\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"))
			_ = conn.Close()
		}
	}()
	u, _ := url.Parse("http://" + ln.Addr().String())
	sessions, cookie := signedIn(t)
	h := New(u, sessions)
	body := bytes.Repeat([]byte("x"), 4<<20)
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodPut, "/dav/alice/list/x.ics", bytes.NewReader(body))
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusRequestEntityTooLarge {
			t.Fatalf("attempt %d: got %d want 413", i, rec.Code)
		}
	}
}

func TestLargeBodyAccepted(t *testing.T) {
	var got int
	u := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		b, err := io.ReadAll(r.Body)
		if err != nil {
			t.Error(err)
		}
		got = len(b)
		w.WriteHeader(http.StatusCreated)
	})
	sessions, cookie := signedIn(t)
	gw := httptest.NewServer(New(u, sessions))
	defer gw.Close()
	body := bytes.Repeat([]byte("x"), 4<<20)
	req, _ := http.NewRequest(http.MethodPut, gw.URL+"/dav/alice/list/x.ics", bytes.NewReader(body))
	req.AddCookie(cookie)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusCreated || got != len(body) {
		t.Fatalf("status %d, upstream read %d of %d bytes", resp.StatusCode, got, len(body))
	}
}

func TestMethodAllowlist(t *testing.T) {
	u := upstream(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	sessions, cookie := signedIn(t)
	h := New(u, sessions)
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
		req.AddCookie(cookie)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != want {
			t.Errorf("%s: got %d want %d", method, rec.Code, want)
		}
	}
}
