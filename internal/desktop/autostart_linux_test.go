//go:build linux

package desktop

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAutostartLinuxEntry(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("WAVEN_AUTOSTART_DIR", dir)

	if err := setAutostart(true, true); err != nil {
		t.Fatalf("setAutostart: %v", err)
	}
	path := filepath.Join(dir, "waven.desktop")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	contents := string(body)
	if !strings.Contains(contents, "Name=WAVEN") {
		t.Fatalf("entry missing Name: %q", contents)
	}
	executable, err := autostartExecutable()
	if err != nil {
		t.Fatalf("autostartExecutable: %v", err)
	}
	if !strings.Contains(contents, executable) {
		t.Fatalf("entry missing executable %q: %q", executable, contents)
	}
	if !strings.Contains(contents, "--hidden") {
		t.Fatalf("entry missing --hidden: %q", contents)
	}

	if err := setAutostart(true, false); err != nil {
		t.Fatalf("setAutostart: %v", err)
	}
	body, err = os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile: %v", err)
	}
	if strings.Contains(string(body), "--hidden") {
		t.Fatalf("visible autostart entry should not pass --hidden: %q", body)
	}

	if err := setAutostart(false, false); err != nil {
		t.Fatalf("setAutostart(false): %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("autostart entry still exists: %v", err)
	}
}

func TestDesktopExecArgQuotesShellCharacters(t *testing.T) {
	got := desktopExecArg(`/opt/WAVEN Player/$HOME/100%`)
	want := `"/opt/WAVEN Player/\$HOME/100%%"`
	if got != want {
		t.Fatalf("desktopExecArg = %q, want %q", got, want)
	}
}
