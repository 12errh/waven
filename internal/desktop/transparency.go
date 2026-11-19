package desktop

import "runtime"

// The three appearance modes are shared by the native window options and the
// CSS layer. Go uses the saved mode at launch to pick a native background type;
// the frontend switches the opaque/translucent layers immediately.
const (
	WindowModeGlass = "glass"
	WindowModePure  = "pure"
	WindowModeSolid = "solid"
)

func isWindowMode(value string) bool {
	return value == WindowModeGlass || value == WindowModePure || value == WindowModeSolid
}

func normalizeWindowMode(value string) string {
	if isWindowMode(value) {
		return value
	}
	return platformDefaultWindowMode()
}

// platformDefaultWindowMode chooses a safe startup appearance. Windows 10 (and
// Windows 11 before 22H2) has no reliable Acrylic backdrop, so those builds
// start with the opaque Solid mode. Linux and macOS start with Glass, matching
// the locked-in visual direction; Linux compositors may still need Solid.
func platformDefaultWindowMode() string {
	if runtime.GOOS == "windows" && !windowsSupportsAcrylic() {
		return WindowModeSolid
	}
	return WindowModeGlass
}
