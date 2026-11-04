package main

import (
	"os/exec"
	"strings"
	"testing"
)

func TestConfig(t *testing.T) {
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	if _, err := loadConfig(env(map[string]string{})); err == nil {
		t.Error("missing URL accepted")
	}
	for _, bad := range []string{"ftp://x", "http://u:p@x", "http://x/path", "http://x?q=1"} {
		if _, err := loadConfig(env(map[string]string{"HAKEN_RADICALE_URL": bad})); err == nil {
			t.Errorf("%s accepted", bad)
		}
	}
	cfg, err := loadConfig(env(map[string]string{"HAKEN_RADICALE_URL": "http://radicale:5232", "HAKEN_SESSION_IDLE": "1h"}))
	if err != nil || cfg.Radicale.Host != "radicale:5232" || cfg.SessionIdle.Hours() != 1 || cfg.Listen != ":8080" {
		t.Errorf("valid config: %+v %v", cfg, err)
	}
}

// The gateway uses the standard library only (ADR-20261103-go-stdlib-gateway).
func TestStdlibOnly(t *testing.T) {
	out, err := exec.Command("go", "list", "-deps", "-f", "{{if not .Standard}}{{.ImportPath}}{{end}}", "./...").Output()
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Fields(string(out)) {
		if !strings.HasPrefix(line, "github.com/Tiliavir/haken/gateway") {
			t.Errorf("non-stdlib dependency: %s", line)
		}
	}
}
