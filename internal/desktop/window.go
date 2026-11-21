package desktop

import (
	"runtime"
)

// WindowService exposes window actions that are not part of the custom header,
// such as quitting from Settings and reading the About information.
type WindowService struct {
	shell *Desktop
}

func NewWindowService(shell *Desktop) *WindowService {
	return &WindowService{shell: shell}
}

// ServiceName makes generated bindings call this service "Window".
func (s *WindowService) ServiceName() string { return "Window" }

// Show restores and focuses the main window.
func (s *WindowService) Show() {
	if s.shell != nil {
		s.shell.Show()
	}
}

// Hide sends the window to the tray.
func (s *WindowService) Hide() {
	if s.shell != nil {
		s.shell.Hide()
	}
}

// ShowMini switches the window to the compact mini player.
func (s *WindowService) ShowMini() {
	if s.shell != nil {
		s.shell.ShowMini()
	}
}

// ShowFull expands the mini player back to the full window.
func (s *WindowService) ShowFull() {
	if s.shell != nil {
		s.shell.ShowFull()
	}
}

// ToggleMini switches between the mini player and the full window.
func (s *WindowService) ToggleMini() {
	if s.shell != nil {
		s.shell.ToggleMini()
	}
}

// IsMini reports whether the window is currently the mini player.
func (s *WindowService) IsMini() bool {
	if s.shell == nil {
		return false
	}
	return s.shell.IsMini()
}

// SetAlwaysOnTop pins or unpins the window. The mini player uses this so a
// preference change applies without a restart.
func (s *WindowService) SetAlwaysOnTop(onTop bool) {
	if s.shell != nil {
		s.shell.SetAlwaysOnTop(onTop)
	}
}

// Quit exits the process, including playback. The result is returned before
// the event loop tears down so the caller's promise settles.
func (s *WindowService) Quit() {
	if s.shell == nil {
		return
	}
	go s.shell.Quit()
}

// Info reports version, paths, and shell capabilities for the About section.
func (s *WindowService) Info() AppInfo {
	info := appInfo()
	info.Platform = runtime.GOOS
	if s.shell != nil {
		info.TrayAvailable = s.shell.trayAvailable.Load()
	}
	return info
}
