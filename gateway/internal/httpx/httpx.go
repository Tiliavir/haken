// Package httpx holds small helpers shared by the gateway packages: error
// ids, JSON responses and the request checks every endpoint applies.
package httpx

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
)

// ErrorID returns a random 16-character hex id that links a client error
// task to the gateway log line.
func ErrorID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return hex.EncodeToString(b[:])
}

// JSON writes v with the given status.
func JSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("write json response", "error", err)
	}
}

// Fail logs an unexpected or rejected request with an error id and answers
// with that id. Never logs credentials, bodies or query strings.
func Fail(w http.ResponseWriter, r *http.Request, status int, reason string) {
	id := ErrorID()
	level := slog.LevelWarn
	if status >= 500 {
		level = slog.LevelError
	}
	slog.Log(r.Context(), level, "request failed", "errorId", id, "status", status, "method", r.Method, "path", r.URL.Path, "reason", reason)
	JSON(w, status, map[string]string{"errorId": id})
}

// SameOrigin rejects cross-site requests. Browsers send Sec-Fetch-Site; when
// present it must be same-origin. When Origin is present it must match the
// request host. Non-browser clients send neither.
func SameOrigin(r *http.Request) bool {
	if site := r.Header.Get("Sec-Fetch-Site"); site != "" && site != "same-origin" && site != "none" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	return origin == "https://"+r.Host || origin == "http://"+r.Host
}
