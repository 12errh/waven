//go:build windows

package desktop

import (
	"errors"
	"fmt"
	"strings"

	"golang.org/x/sys/windows/registry"
)

const autostartRunKey = `Software\Microsoft\Windows\CurrentVersion\Run`

// setAutostart writes the per-user Run entry. HKCU needs no administrator
// rights, and Windows removes the value cleanly when the setting is disabled.
func setAutostart(enabled, startHidden bool) error {
	key, err := registry.OpenKey(registry.CURRENT_USER, autostartRunKey, registry.SET_VALUE|registry.QUERY_VALUE)
	if err != nil {
		return fmt.Errorf("open autostart registry key: %w", err)
	}
	defer key.Close()

	if !enabled {
		err := key.DeleteValue("WAVEN")
		if errors.Is(err, registry.ErrNotExist) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("remove autostart entry: %w", err)
		}
		return nil
	}

	executable, err := autostartExecutable()
	if err != nil {
		return err
	}
	command := `"` + executable + `"`
	if args := autostartArgs(startHidden); len(args) > 0 {
		command += " " + strings.Join(args, " ")
	}
	if err := key.SetStringValue("WAVEN", command); err != nil {
		return fmt.Errorf("write autostart entry: %w", err)
	}
	return nil
}
