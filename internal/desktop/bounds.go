package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// WindowBounds is the persisted placement of the main window. Width and
// Height describe the normal (restored) window, never the maximised frame, so
// leaving maximised mode returns the window to the size the user chose.
type WindowBounds struct {
	X         int  `json:"x"`
	Y         int  `json:"y"`
	Width     int  `json:"width"`
	Height    int  `json:"height"`
	Maximized bool `json:"maximized"`
}

// fitWindowBounds turns a saved placement into a rectangle that is fully
// visible on a currently connected display. A saved window on a monitor that
// has since been disconnected falls back to the primary display; a window
// partially off-screen is clamped back into the nearest work area.
func fitWindowBounds(
	saved WindowBounds,
	hasSaved bool,
	screens []*application.Screen,
	defaultWidth, defaultHeight, minWidth, minHeight int,
) (application.Rect, bool) {
	if len(screens) == 0 {
		return application.Rect{}, false
	}

	primary := screens[0]
	for _, screen := range screens {
		if screen != nil && screen.IsPrimary {
			primary = screen
			break
		}
	}
	if primary == nil {
		return application.Rect{}, false
	}

	target := primary
	useSavedPosition := false
	if hasSaved && saved.Width > 0 && saved.Height > 0 {
		bestArea := 0
		for _, screen := range screens {
			if screen == nil {
				continue
			}
			area := intersectionArea(
				application.Rect{X: saved.X, Y: saved.Y, Width: saved.Width, Height: saved.Height},
				screen.WorkArea,
			)
			if area > bestArea {
				bestArea = area
				target = screen
				useSavedPosition = area > 0
			}
		}
	}

	work := target.WorkArea
	if work.Width <= 0 || work.Height <= 0 {
		work = target.Bounds
	}
	if work.Width <= 0 || work.Height <= 0 {
		return application.Rect{}, false
	}

	width, height := defaultWidth, defaultHeight
	if hasSaved && saved.Width > 0 && saved.Height > 0 {
		width, height = saved.Width, saved.Height
	}

	// A window that exactly fills the work area is auto-maximised by some
	// compositors (Mutter does this on map). First launches keep a small edge
	// margin so the app opens windowed; a saved size is honoured because the
	// user chose it.
	maxWidth, maxHeight := work.Width, work.Height
	if !useSavedPosition {
		maxWidth = work.Width - 2*windowEdgeMargin
		maxHeight = work.Height - 2*windowEdgeMargin
	}
	width = clampInt(width, minWidth, maxWidth)
	height = clampInt(height, minHeight, maxHeight)

	x, y := 0, 0
	if useSavedPosition {
		x = clampInt(saved.X, work.X, work.X+work.Width-width)
		y = clampInt(saved.Y, work.Y, work.Y+work.Height-height)
	} else {
		x = work.X + (work.Width-width)/2
		y = work.Y + (work.Height-height)/2
	}

	return application.Rect{X: x, Y: y, Width: width, Height: height}, true
}

func intersectionArea(a, b application.Rect) int {
	left := max(a.X, b.X)
	top := max(a.Y, b.Y)
	right := min(a.X+a.Width, b.X+b.Width)
	bottom := min(a.Y+a.Height, b.Y+b.Height)
	if right <= left || bottom <= top {
		return 0
	}
	return (right - left) * (bottom - top)
}

func clampInt(value, low, high int) int {
	if high < low {
		high = low
	}
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}
