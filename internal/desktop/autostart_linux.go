//go:build linux

package desktop

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// setAutostart installs or removes an XDG autostart entry. Linux desktop
// environments read ~/.config/autostart at login; no privileged service or
// shell command is needed.
func setAutostart(enabled, startHidden bool) error {
	path, err := autostartPath()
	if err != nil {
		return err
	}
	if !enabled {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("remove autostart entry: %w", err)
		}
		return nil
	}

	executable, err := autostartExecutable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create autostart directory: %w", err)
	}
	if err := os.WriteFile(path, []byte(desktopEntry(executable, startHidden)), 0o644); err != nil {
		return fmt.Errorf("write autostart entry: %w", err)
	}
	return nil
}

func autostartPath() (string, error) {
	dir := os.Getenv("WAVEN_AUTOSTART_DIR")
	if dir == "" {
		config, err := os.UserConfigDir()
		if err != nil {
			return "", fmt.Errorf("resolve config directory: %w", err)
		}
		dir = filepath.Join(config, "autostart")
	}
	return filepath.Join(dir, "waven.desktop"), nil
}

func desktopEntry(executable string, startHidden bool) string {
	args := autostartArgs(startHidden)
	exec := desktopExecArg(executable)
	if len(args) > 0 {
		exec += " " + strings.Join(args, " ")
	}
	return `[Desktop Entry]
Type=Application
Name=WAVEN
Comment=Local-first music player
Exec=` + exec + `
Terminal=false
Categories=AudioVideo;Audio;Player;
X-GNOME-Autostart-enabled=true
`
}

func desktopExecArg(value string) string {
	replacer := strings.NewReplacer(
		`\`, `\\`,
		`"`, `\"`,
		"`", "\\`",
		`$`, `\$`,
		`%`, `%%`,
	)
	return `"` + replacer.Replace(value) + `"`
}
