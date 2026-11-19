//go:build windows

package desktop

import "golang.org/x/sys/windows"

// windowsSupportsAcrylic reports whether the OS build can render the Windows
// Acrylic backdrop. The API needs Windows 11 22H2 (build 22621) or newer.
func windowsSupportsAcrylic() bool {
	version := windows.RtlGetVersion()
	return version != nil && version.BuildNumber >= 22621
}
