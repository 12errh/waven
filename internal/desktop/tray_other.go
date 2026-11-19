//go:build !linux

package desktop

import "log"

// activateTray is only meaningful on Linux, where the smoke test talks to the
// StatusNotifierItem service directly.
func activateTray() error {
	return nil
}

// watchTrayHost is a no-op on platforms where the system tray is part of the
// desktop environment.
func watchTrayHost(onChange func(bool)) func() {
	log.Printf("tray: using the native system tray")
	onChange(true)
	return func() {}
}
