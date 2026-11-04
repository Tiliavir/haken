// Package proxy forwards /dav/ to Radicale, restricted to the user's own
// collections (defence in depth on top of Radicale's owner_only rights).
package proxy

import (
	"errors"
	"log/slog"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/Tiliavir/haken/gateway/internal/httpx"
	"github.com/Tiliavir/haken/gateway/internal/session"
)

// Prefix is the public path of the CalDAV proxy. Radicale learns it through
// X-Script-Name and writes it into every href.
const Prefix = "/dav"

// MaxBody caps request bodies (inline attachments are at most 5 MB each before encoding).
const MaxBody = 32 << 20

var methods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodOptions: true, http.MethodPut: true, http.MethodDelete: true,
	"PROPFIND": true, "PROPPATCH": true, "REPORT": true, "MKCALENDAR": true, "MKCOL": true, "MOVE": true, "COPY": true,
}

// New returns the /dav/ handler.
func New(radicale *url.URL, sessions *session.Manager) http.Handler {
	rp := &httputil.ReverseProxy{
		Rewrite: func(pr *httputil.ProxyRequest) {
			pr.SetURL(radicale)
			pr.Out.URL.Path = strings.TrimPrefix(pr.In.URL.Path, Prefix)
			pr.Out.URL.RawPath = ""
			pr.Out.URL.RawQuery = ""
			pr.Out.Header.Del("Cookie")
			pr.Out.Header.Set("X-Script-Name", Prefix)
			pr.Out.Host = radicale.Host
		},
		ModifyResponse: func(resp *http.Response) error {
			resp.Header.Del("Set-Cookie")
			return nil
		},
		ErrorHandler: func(w http.ResponseWriter, r *http.Request, err error) {
			var maxErr *http.MaxBytesError
			if errors.As(err, &maxErr) {
				httpx.Fail(w, r, http.StatusRequestEntityTooLarge, "body too large")
				return
			}
			id := httpx.ErrorID()
			slog.Error("radicale unreachable", "errorId", id, "method", r.Method, "path", r.URL.Path, "reason", err.Error())
			httpx.JSON(w, http.StatusBadGateway, map[string]string{"errorId": id})
		},
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if !methods[r.Method] {
			httpx.Fail(w, r, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		user, ok := authorize(r, sessions)
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="haken", charset="UTF-8"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if !allowedPath(r.URL.Path, user) {
			httpx.Fail(w, r, http.StatusForbidden, "path outside the user's collections")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, MaxBody)
		rp.ServeHTTP(w, r)
	})
}

// authorize returns the user the request acts as. The session cookie wins
// (the PWA); otherwise Basic auth is passed through unchanged (other CalDAV
// clients). A session request must be same-origin.
func authorize(r *http.Request, sessions *session.Manager) (string, bool) {
	if creds, ok := sessions.Lookup(r); ok {
		if !httpx.SameOrigin(r) {
			return "", false
		}
		r.SetBasicAuth(creds.User, creds.Password)
		return creds.User, true
	}
	user, _, ok := r.BasicAuth()
	if !ok || !session.UserPattern.MatchString(user) {
		return "", false
	}
	return user, true
}

// allowedPath admits only /dav/<user> and everything below it. The raw path
// must already be clean: no dot segments, no encoded slashes.
func allowedPath(p, user string) bool {
	if strings.Contains(p, "/../") || strings.HasSuffix(p, "/..") || strings.Contains(p, "/./") || strings.Contains(p, "//") {
		return false
	}
	base := Prefix + "/" + user
	return p == base || strings.HasPrefix(p, base+"/")
}
