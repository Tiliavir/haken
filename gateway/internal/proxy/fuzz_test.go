package proxy

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"path"
	"strings"
	"sync"
	"testing"
)

// underUser reports whether p, as Radicale resolves it, lies in user's own tree.
func underUser(p, user string) bool {
	clean := path.Clean("/" + p)
	return clean == "/"+user || strings.HasPrefix(clean, "/"+user+"/")
}

// FuzzAllowedPath: an admitted path never resolves outside /dav/<user>.
func FuzzAllowedPath(f *testing.F) {
	for _, s := range []struct{ p, u string }{
		{"/dav/alice/list/x.ics", "alice"}, {"/dav/alice/../bob/", "alice"}, {"/dav/alicex", "alice"},
		{"/dav/alice/..", "alice"}, {"/dav/a/b", "a"}, {"/dav/a/./b", "a"}, {"/dav//a", "a"}, {"/dav/a", ".."},
	} {
		f.Add(s.p, s.u)
	}
	f.Fuzz(func(t *testing.T, p, user string) {
		if user == "" || !allowedPath(p, user) {
			return
		}
		if !underUser(strings.TrimPrefix(p, Prefix), user) {
			t.Errorf("admitted %q for %q", p, user)
		}
	})
}

// FuzzProxyPath: whatever request line a client sends, Radicale only sees
// paths in the signed-in user's tree (decoding, dot segments, encoded slashes).
func FuzzProxyPath(f *testing.F) {
	for _, s := range []string{
		"/dav/alice/list/x.ics", "/dav/alice/%2e%2e/bob/", "/dav/alice/..%2fbob", "/dav/alice%2f..%2fbob",
		"/dav/alice/%252e%252e/bob", "/dav/alice/x/../../bob", "/dav/alice\\..\\bob", "/dav/%61lice/", "//dav/alice",
	} {
		f.Add(s)
	}
	sessions, cookie := signedIn(f)
	var mu sync.Mutex
	var seen []string
	u := upstream(f, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		seen = append(seen, r.URL.Path)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	})
	h := New(u, sessions)
	f.Fuzz(func(t *testing.T, target string) {
		raw := "GET " + target + " HTTP/1.1\r\nHost: haken.test\r\nCookie: " + cookie.String() + "\r\n\r\n"
		req, err := http.ReadRequest(bufio.NewReader(strings.NewReader(raw)))
		if err != nil {
			return
		}
		mu.Lock()
		seen = seen[:0]
		mu.Unlock()
		h.ServeHTTP(httptest.NewRecorder(), req)
		mu.Lock()
		defer mu.Unlock()
		for _, p := range seen {
			if !underUser(p, "alice") {
				t.Errorf("request %q reached Radicale as %q", target, p)
			}
		}
	})
}
