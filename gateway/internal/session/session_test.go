package session

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func fakeRadicale(t *testing.T) *url.URL {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if r.Method != "PROPFIND" || !ok || user != "alice" || pass != "secret" || r.URL.Path != "/alice/" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.WriteHeader(http.StatusMultiStatus)
	}))
	t.Cleanup(srv.Close)
	u, _ := url.Parse(srv.URL)
	return u
}

func post(m *Manager, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, req)
	return rec
}

func TestLoginProbeLogout(t *testing.T) {
	m := New(fakeRadicale(t), time.Hour, NewLimiter(5, time.Minute))
	rec := post(m, `{"user":"alice","password":"secret"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d", rec.Code)
	}
	cookie := rec.Result().Cookies()[0]
	if cookie.Name != CookieName || !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("cookie attributes: %+v", cookie)
	}
	probe := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	probe.AddCookie(cookie)
	rec = httptest.NewRecorder()
	m.ServeHTTP(rec, probe)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != `{"user":"alice"}` {
		t.Fatalf("probe: %d %q", rec.Code, rec.Body.String())
	}
	del := httptest.NewRequest(http.MethodDelete, "/api/session", nil)
	del.AddCookie(cookie)
	rec = httptest.NewRecorder()
	m.ServeHTTP(rec, del)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("logout: %d", rec.Code)
	}
	rec = httptest.NewRecorder()
	m.ServeHTTP(rec, probe)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("probe after logout: %d", rec.Code)
	}
}

func TestStrictInput(t *testing.T) {
	m := New(fakeRadicale(t), time.Hour, NewLimiter(5, time.Minute))
	for _, body := range []string{
		`{"user":"alice","password":"secret","extra":1}`,
		`{"user":"alice"}`,
		`{"user":"../x","password":"p"}`,
		`[]`,
		`{"user":"alice","password":"secret"}{}`,
	} {
		if rec := post(m, body); rec.Code != http.StatusBadRequest {
			t.Errorf("%s: %d", body, rec.Code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "text/plain")
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnsupportedMediaType {
		t.Errorf("content type: %d", rec.Code)
	}
}

func TestRateLimit(t *testing.T) {
	m := New(fakeRadicale(t), time.Hour, NewLimiter(3, time.Minute))
	for i := 0; i < 3; i++ {
		if rec := post(m, `{"user":"alice","password":"wrong"}`); rec.Code != http.StatusUnauthorized {
			t.Fatalf("attempt %d: %d", i, rec.Code)
		}
	}
	rec := post(m, `{"user":"alice","password":"secret"}`)
	if rec.Code != http.StatusTooManyRequests || rec.Header().Get("Retry-After") == "" {
		t.Fatalf("expected 429 with Retry-After, got %d", rec.Code)
	}
}

func TestIdleExpiry(t *testing.T) {
	m := New(fakeRadicale(t), time.Minute, NewLimiter(5, time.Minute))
	now := time.Now()
	m.now = func() time.Time { return now }
	cookie := post(m, `{"user":"alice","password":"secret"}`).Result().Cookies()[0]
	req := httptest.NewRequest(http.MethodGet, "/api/session", nil)
	req.AddCookie(cookie)
	now = now.Add(2 * time.Minute)
	if _, ok := m.Lookup(req); ok {
		t.Fatal("session should have expired")
	}
}

func TestCrossSiteRejected(t *testing.T) {
	m := New(fakeRadicale(t), time.Hour, NewLimiter(5, time.Minute))
	req := httptest.NewRequest(http.MethodPost, "/api/session", strings.NewReader(`{"user":"alice","password":"secret"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	rec := httptest.NewRecorder()
	m.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-site: %d", rec.Code)
	}
}

func TestLimiterPerKey(t *testing.T) {
	l := NewLimiter(2, time.Minute)
	now := time.Now()
	l.now = func() time.Time { return now }
	l.Fail("ip:a", "user:alice")
	l.Fail("ip:a", "user:alice")
	if l.Blocked("ip:a") == 0 || l.Blocked("user:alice") == 0 {
		t.Fatal("keys at the limit must be blocked")
	}
	if l.Blocked("ip:b", "user:bob") != 0 {
		t.Fatal("other keys must not be blocked")
	}
	if l.Blocked("ip:b", "user:alice") == 0 {
		t.Fatal("one blocked key blocks the attempt")
	}
	l.Fail("ip:b")
	if l.Blocked("ip:b") != 0 {
		t.Fatal("one failure is below the limit")
	}
	l.Reset("user:alice")
	if l.Blocked("user:alice") != 0 || l.Blocked("ip:a") == 0 {
		t.Fatal("reset must clear only the given key")
	}
	now = now.Add(30 * time.Second)
	if w := l.Blocked("ip:a"); w != 30*time.Second {
		t.Fatalf("wait %v, want 30s", w)
	}
	now = now.Add(30 * time.Second)
	if l.Blocked("ip:a") != 0 {
		t.Fatal("failures older than the window must expire")
	}
}
