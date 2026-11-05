// Package session implements /api/session: login against Radicale, an
// in-memory session store and a login rate limit
// (docs/arc42/adr/ADR-20261103-authentication.md).
//
// Credentials live only in memory, only for verified logins, and are never
// logged. A gateway restart ends all sessions.
package session

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Tiliavir/haken/gateway/internal/httpx"
)

// CookieName uses the __Host- prefix: Secure, Path=/, no Domain.
const CookieName = "__Host-haken"

// UserPattern restricts user names to characters that need no escaping in a
// path and in Basic auth.
var UserPattern = regexp.MustCompile(`^[A-Za-z0-9._@-]{1,64}$`)

// Credentials of one verified session.
type Credentials struct {
	User     string
	Password string
}

type entry struct {
	creds    Credentials
	lastSeen time.Time
}

// Manager holds sessions and verifies logins.
type Manager struct {
	radicale *url.URL
	client   *http.Client
	idle     time.Duration
	now      func() time.Time
	limiter  *Limiter

	mu       sync.Mutex
	sessions map[string]*entry
}

// New returns a manager verifying against the Radicale base URL.
func New(radicale *url.URL, idle time.Duration, limiter *Limiter) *Manager {
	return &Manager{
		radicale: radicale,
		client:   &http.Client{Timeout: 15 * time.Second},
		idle:     idle,
		now:      time.Now,
		limiter:  limiter,
		sessions: map[string]*entry{},
	}
}

// Lookup returns the credentials for the request's session cookie and
// refreshes its idle timer.
func (m *Manager) Lookup(r *http.Request) (Credentials, bool) {
	c, err := r.Cookie(CookieName)
	if err != nil {
		return Credentials{}, false
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.sessions[c.Value]
	if !ok {
		return Credentials{}, false
	}
	now := m.now()
	if now.Sub(e.lastSeen) > m.idle {
		delete(m.sessions, c.Value)
		return Credentials{}, false
	}
	e.lastSeen = now
	return e.creds, true
}

// Sweep removes idle sessions; call it periodically.
func (m *Manager) Sweep() {
	m.mu.Lock()
	defer m.mu.Unlock()
	now := m.now()
	for id, e := range m.sessions {
		if now.Sub(e.lastSeen) > m.idle {
			delete(m.sessions, id)
		}
	}
}

func newID() string {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

// ClientKey identifies the client for rate limiting. Only RemoteAddr is used:
// X-Forwarded-For is not trusted (ADR-20261105-gateway-security).
func ClientKey(r *http.Request) string {
	host := r.RemoteAddr
	if i := strings.LastIndexByte(host, ':'); i > 0 {
		host = host[:i]
	}
	return host
}

type loginRequest struct {
	User     string `json:"user"`
	Password string `json:"password"`
}

// ServeHTTP handles GET (probe), POST (login) and DELETE (logout).
func (m *Manager) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Path != "/api/session" {
		httpx.Fail(w, r, http.StatusNotFound, "unknown api path")
		return
	}
	if !httpx.SameOrigin(r) {
		httpx.Fail(w, r, http.StatusForbidden, "cross-site request")
		return
	}
	switch r.Method {
	case http.MethodGet:
		creds, ok := m.Lookup(r)
		if !ok {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		httpx.JSON(w, http.StatusOK, map[string]string{"user": creds.User})
	case http.MethodPost:
		m.login(w, r)
	case http.MethodDelete:
		m.logout(w, r)
	default:
		w.Header().Set("Allow", "GET, POST, DELETE")
		httpx.Fail(w, r, http.StatusMethodNotAllowed, "method not allowed")
	}
}

func (m *Manager) login(w http.ResponseWriter, r *http.Request) {
	if ct := r.Header.Get("Content-Type"); ct != "application/json" {
		httpx.Fail(w, r, http.StatusUnsupportedMediaType, "content type")
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 4096))
	if err != nil {
		httpx.Fail(w, r, http.StatusRequestEntityTooLarge, "body too large")
		return
	}
	var req loginRequest
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil || dec.More() {
		httpx.Fail(w, r, http.StatusBadRequest, "body shape")
		return
	}
	if !UserPattern.MatchString(req.User) || req.Password == "" || len(req.Password) > 1024 {
		httpx.Fail(w, r, http.StatusBadRequest, "field values")
		return
	}
	keys := []string{"ip:" + ClientKey(r), "user:" + req.User}
	if wait := m.limiter.Blocked(keys...); wait > 0 {
		w.Header().Set("Retry-After", strconv.Itoa(int(wait.Seconds()+0.999)))
		w.WriteHeader(http.StatusTooManyRequests)
		return
	}
	ok, err := m.verify(r.Context(), req.User, req.Password)
	if err != nil {
		id := httpx.ErrorID()
		slog.Error("radicale verification failed", "errorId", id, "reason", err.Error())
		httpx.JSON(w, http.StatusBadGateway, map[string]string{"errorId": id})
		return
	}
	if !ok {
		m.limiter.Fail(keys...)
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	m.limiter.Reset(keys...)
	id := newID()
	m.mu.Lock()
	m.sessions[id] = &entry{creds: Credentials(req), lastSeen: m.now()}
	m.mu.Unlock()
	http.SetCookie(w, &http.Cookie{
		Name:     CookieName,
		Value:    id,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
	})
	httpx.JSON(w, http.StatusOK, map[string]string{"user": req.User})
}

func (m *Manager) logout(w http.ResponseWriter, r *http.Request) {
	if c, err := r.Cookie(CookieName); err == nil {
		m.mu.Lock()
		delete(m.sessions, c.Value)
		m.mu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: CookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: true, SameSite: http.SameSiteStrictMode})
	w.WriteHeader(http.StatusNoContent)
}

// errUnexpected marks a Radicale answer that is neither success nor 401.
var errUnexpected = errors.New("unexpected radicale status")

// verify checks the credentials with a PROPFIND on the user's own principal.
func (m *Manager) verify(ctx context.Context, user, password string) (bool, error) {
	target := m.radicale.JoinPath(user) // user matched UserPattern: no escaping needed
	body := strings.NewReader(`<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><current-user-principal/></prop></propfind>`)
	req, err := http.NewRequestWithContext(ctx, "PROPFIND", target.String()+"/", body)
	if err != nil {
		return false, err
	}
	req.SetBasicAuth(user, password)
	req.Header.Set("Depth", "0")
	req.Header.Set("Content-Type", "application/xml; charset=utf-8")
	resp, err := m.client.Do(req)
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<20))
	switch resp.StatusCode {
	case http.StatusMultiStatus:
		return true, nil
	case http.StatusUnauthorized, http.StatusForbidden:
		return false, nil
	default:
		return false, errors.Join(errUnexpected, errors.New(strconv.Itoa(resp.StatusCode)))
	}
}
