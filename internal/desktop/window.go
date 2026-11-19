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
