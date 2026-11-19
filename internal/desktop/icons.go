package desktop

import _ "embed"

//go:embed assets/appicon.png
var appIcon []byte

//go:embed assets/tray.png
var trayIcon []byte

// AppIcon returns the PNG application icon used by the OS shell.
func AppIcon() []byte {
	return appIcon
}
