//go:build !windows

package desktop

// windowsSupportsAcrylic is only consulted on Windows; other platforms keep
// the Glass default without a build-number check.
func windowsSupportsAcrylic() bool { return true }
