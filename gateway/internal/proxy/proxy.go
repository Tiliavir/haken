// Package proxy forwards /dav/ to Radicale for the haken app only: it accepts
// the session cookie and nothing else, restricted to the user's own collections
// (defence in depth on top of Radicale's owner_only rights). Other CalDAV
// clients talk to Radicale directly.
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

// expectAbove: larger (or unknown-length) bodies are sent with "Expect:
// 100-continue". Radicale rejects too large bodies (413) from the headers and
// closes without reading; without the wait, the body write fails first and the
// client would get 502 instead of 413. Radicale's HTTP/1.0 server never sends
// 100, so accepted bodies wait the Transport's ExpectContinueTimeout (1 s).
const expectAbove = 64 << 10

// methods is the allowlist. MOVE and COPY are excluded: their Destination
// header names a second path that allowedPath does not check.
var methods = map[string]bool{
	http.MethodGet: true, http.MethodHead: true, http.MethodOptions: true, http.MethodPut: true, http.MethodDelete: true,
	"PROPFIND": true, "PROPPATCH": true, "REPORT": true, "MKCALENDAR": true, "MKCOL": true,
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
			if pr.In.ContentLength > expectAbove || pr.In.ContentLength < 0 {
				pr.Out.Header.Set("Expect", "100-continue")
			}
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
		if r.Header.Get("Authorization") != "" {
			httpx.Fail(w, r, http.StatusUnauthorized, "Authorization header refused, session only")
			return
		}
		creds, ok := sessions.Lookup(r)
		if !ok {
			httpx.Fail(w, r, http.StatusUnauthorized, "no session")
			return
		}
		if !httpx.SameOrigin(r) {
			httpx.Fail(w, r, http.StatusForbidden, "cross-origin request")
			return
		}
		user := creds.User
		if !allowedPath(r.URL.Path, user) {
			httpx.Fail(w, r, http.StatusForbidden, "path outside the user's collections")
			return
		}
		r.SetBasicAuth(creds.User, creds.Password)
		r.Body = http.MaxBytesReader(w, r.Body, MaxBody)
		rp.ServeHTTP(w, r)
	})
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
