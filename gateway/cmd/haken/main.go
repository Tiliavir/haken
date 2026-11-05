// Command haken is the gateway: it serves the embedded app, /api/session and
// the /dav proxy to Radicale (docs/arc42/adr/ADR-20261103-go-stdlib-gateway.md).
package main

import (
	"context"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Tiliavir/haken/gateway/internal/proxy"
	"github.com/Tiliavir/haken/gateway/internal/session"
	"github.com/Tiliavir/haken/gateway/internal/static"
)

// Config comes from the environment only.
type Config struct {
	Listen      string
	Radicale    *url.URL
	SessionIdle time.Duration
}

func loadConfig(getenv func(string) string) (Config, error) {
	cfg := Config{Listen: ":8080", SessionIdle: 7 * 24 * time.Hour}
	if v := getenv("HAKEN_LISTEN"); v != "" {
		cfg.Listen = v
	}
	raw := getenv("HAKEN_RADICALE_URL")
	if raw == "" {
		return cfg, errors.New("HAKEN_RADICALE_URL is required, e.g. http://radicale:5232")
	}
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.User != nil {
		return cfg, errors.New("HAKEN_RADICALE_URL must be http(s)://host[:port] without path, query or credentials")
	}
	u.Path = ""
	cfg.Radicale = u
	if v := getenv("HAKEN_SESSION_IDLE"); v != "" {
		d, err := time.ParseDuration(v)
		if err != nil || d < time.Minute {
			return cfg, errors.New("HAKEN_SESSION_IDLE must be a Go duration of at least 1m")
		}
		cfg.SessionIdle = d
	}
	return cfg, nil
}

// NewHandler wires the routes.
func NewHandler(cfg Config, app fs.FS, sessions *session.Manager) http.Handler {
	mux := http.NewServeMux()
	mux.Handle("/api/", withHeaders(sessions))
	mux.Handle(proxy.Prefix+"/", withHeaders(proxy.New(cfg.Radicale, sessions)))
	mux.Handle("/", static.Handler(app))
	return mux
}

func withHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		static.SecurityHeaders(w.Header())
		h.ServeHTTP(w, r)
	})
}

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	cfg, err := loadConfig(os.Getenv)
	if err != nil {
		slog.Error("configuration", "reason", err.Error())
		os.Exit(2)
	}
	app, err := fs.Sub(embedded, "dist")
	if err != nil {
		slog.Error("embedded app", "reason", err.Error())
		os.Exit(2)
	}
	if _, err := fs.Stat(app, "index.html"); err != nil {
		slog.Error("embedded app has no index.html; build with make gateway")
		os.Exit(2)
	}
	sessions := session.New(cfg.Radicale, cfg.SessionIdle, session.NewLimiter(5, 15*time.Minute))
	go func() {
		for range time.Tick(time.Minute) {
			sessions.Sweep()
		}
	}()
	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           NewHandler(cfg, app, sessions),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      2 * time.Minute,
		IdleTimeout:       2 * time.Minute,
		MaxHeaderBytes:    32 << 10,
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("listening", "addr", cfg.Listen, "radicale", cfg.Radicale.Host)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server", "reason", err.Error())
		os.Exit(1)
	}
}
