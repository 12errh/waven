package desktop

import (
	"fmt"
	"os"
	"path/filepath"
)

// autostartExecutable resolves the running binary to an absolute path so a
// login entry keeps working when the app is launched from a different working
// directory.
func autostartExecutable() (string, error) {
	path, err := os.Executable()
	if err != nil {
		return "", fmt.Errorf("locate executable: %w", err)
	}
	resolved, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve executable path: %w", err)
	}
	return resolved, nil
}

func autostartArgs(startHidden bool) []string {
	if startHidden {
		return []string{"--hidden"}
	}
	return nil
}
