//go:build darwin

package desktop

import (
	"fmt"
	"html"
	"os"
	"path/filepath"
	"strings"
)

// setAutostart installs or removes a per-user LaunchAgent. At the next login
// launchd starts WAVEN as the logged-in user; the entry is removed as soon as
// the setting is turned off.
func setAutostart(enabled, startHidden bool) error {
	path, err := autostartPath()
	if err != nil {
		return err
	}
	if !enabled {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("remove autostart agent: %w", err)
		}
		return nil
	}

	executable, err := autostartExecutable()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create LaunchAgents directory: %w", err)
	}
	if err := os.WriteFile(path, []byte(launchAgent(executable, startHidden)), 0o644); err != nil {
		return fmt.Errorf("write autostart agent: %w", err)
	}
	return nil
}

func autostartPath() (string, error) {
	dir := os.Getenv("WAVEN_AUTOSTART_DIR")
	if dir == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("resolve home directory: %w", err)
		}
		dir = filepath.Join(home, "Library", "LaunchAgents")
	}
	return filepath.Join(dir, "app.waven.desktop.plist"), nil
}

func launchAgent(executable string, startHidden bool) string {
	args := []string{executable}
	args = append(args, autostartArgs(startHidden)...)
	var arguments strings.Builder
	for _, arg := range args {
		arguments.WriteString("        <string>")
		arguments.WriteString(html.EscapeString(arg))
		arguments.WriteString("</string>\n")
	}
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>app.waven.desktop</string>
    <key>ProgramArguments</key>
    <array>
` + arguments.String() + `    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>ProcessType</key>
    <string>Interactive</string>
</dict>
</plist>
`
}
