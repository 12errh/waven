package desktop

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func screen(x, y, width, height int, primary bool) *application.Screen {
	return &application.Screen{
		X:         x,
		Y:         y,
		Bounds:    application.Rect{X: x, Y: y, Width: width, Height: height},
		WorkArea:  application.Rect{X: x, Y: y, Width: width, Height: height},
		IsPrimary: primary,
	}
}

func TestFitWindowBoundsKeepsVisibleSavedPlacement(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}
	got, ok := fitWindowBounds(
		WindowBounds{X: 120, Y: 80, Width: 1280, Height: 820},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	want := application.Rect{X: 120, Y: 80, Width: 1280, Height: 820}
	if got != want {
		t.Fatalf("bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsRecoversFromDisconnectedMonitor(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}
	got, ok := fitWindowBounds(
		WindowBounds{X: 5000, Y: 300, Width: 1280, Height: 820},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a fallback rectangle")
	}
	want := application.Rect{X: 320, Y: 130, Width: 1280, Height: 820}
	if got != want {
		t.Fatalf("fallback bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsClampsPartialOffscreenWindow(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1366, 768, true)}
	got, ok := fitWindowBounds(
		WindowBounds{X: -200, Y: -90, Width: 1280, Height: 820},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	want := application.Rect{X: 0, Y: 0, Width: 1280, Height: 768}
	if got != want {
		t.Fatalf("clamped bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsUsesSecondaryMonitor(t *testing.T) {
	screens := []*application.Screen{
		screen(0, 0, 1920, 1080, true),
		screen(1920, 0, 2560, 1440, false),
	}
	got, ok := fitWindowBounds(
		WindowBounds{X: 2100, Y: 120, Width: 1280, Height: 820},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	want := application.Rect{X: 2100, Y: 120, Width: 1280, Height: 820}
	if got != want {
		t.Fatalf("secondary bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsEnforcesMinimumAndWorkArea(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1100, 700, true)}
	got, ok := fitWindowBounds(
		WindowBounds{X: 10, Y: 10, Width: 50, Height: 50},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	if got.Width != 960 || got.Height != 640 {
		t.Fatalf("minimum not applied: %+v", got)
	}

	got, ok = fitWindowBounds(
		WindowBounds{X: 0, Y: 0, Width: 3000, Height: 2000},
		true,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	if got.Width != 1100 || got.Height != 700 {
		t.Fatalf("work area not applied: %+v", got)
	}
}

func TestFitWindowBoundsCentersFirstLaunch(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1600, 900, true)}
	got, ok := fitWindowBounds(
		WindowBounds{},
		false,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	want := application.Rect{X: 160, Y: 40, Width: 1280, Height: 820}
	if got != want {
		t.Fatalf("first-launch bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsLeavesEdgeMarginOnSmallFirstLaunch(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1366, 768, true)}
	got, ok := fitWindowBounds(
		WindowBounds{},
		false,
		screens,
		1280, 820, 960, 640,
	)
	if !ok {
		t.Fatal("expected a visible rectangle")
	}
	want := application.Rect{X: 43, Y: 16, Width: 1280, Height: 736}
	if got != want {
		t.Fatalf("small first-launch bounds = %+v, want %+v", got, want)
	}
}

func TestFitWindowBoundsWithoutScreens(t *testing.T) {
	if _, ok := fitWindowBounds(WindowBounds{}, false, nil, 1280, 820, 960, 640); ok {
		t.Fatal("expected no rectangle when the screen manager is empty")
	}
}

func TestFitMiniBoundsDocksToBottomRight(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}
	got, ok := fitMiniBounds(WindowBounds{}, false, screens)
	if !ok {
		t.Fatal("expected mini bounds")
	}
	want := application.Rect{
		X:      1920 - miniWindowWidth - miniWindowMargin,
		Y:      1080 - miniWindowHeight - miniWindowMargin,
		Width:  miniWindowWidth,
		Height: miniWindowHeight,
	}
	if got != want {
		t.Fatalf("mini bounds = %+v, want %+v", got, want)
	}
}

func TestFitMiniBoundsKeepsVisibleSavedPlacement(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}
	saved := WindowBounds{X: 40, Y: 60, Width: 420, Height: 150}
	got, ok := fitMiniBounds(saved, true, screens)
	if !ok {
		t.Fatal("expected mini bounds")
	}
	want := application.Rect{X: 40, Y: 60, Width: 420, Height: 150}
	if got != want {
		t.Fatalf("mini bounds = %+v, want %+v", got, want)
	}
}

func TestFitMiniBoundsRecoversFromDisconnectedMonitor(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}
	got, ok := fitMiniBounds(WindowBounds{X: 4000, Y: 2000, Width: 380, Height: 128}, true, screens)
	if !ok {
		t.Fatal("expected a fallback rectangle")
	}
	if got.X != 1920-miniWindowWidth-miniWindowMargin || got.Y != 1080-miniWindowHeight-miniWindowMargin {
		t.Fatalf("mini bounds = %+v, want the primary bottom-right corner", got)
	}
}

func TestFitMiniBoundsClampsSavedSize(t *testing.T) {
	screens := []*application.Screen{screen(0, 0, 1920, 1080, true)}

	small, ok := fitMiniBounds(WindowBounds{X: 10, Y: 10, Width: 40, Height: 20}, true, screens)
	if !ok {
		t.Fatal("expected mini bounds")
	}
	if small.Width != miniWindowMinWidth || small.Height != miniWindowMinHeight {
		t.Fatalf("small mini bounds = %dx%d, want %dx%d",
			small.Width, small.Height, miniWindowMinWidth, miniWindowMinHeight)
	}

	large, ok := fitMiniBounds(WindowBounds{X: 10, Y: 10, Width: 4000, Height: 3000}, true, screens)
	if !ok {
		t.Fatal("expected mini bounds")
	}
	if large.Width != miniWindowMaxWidth || large.Height != miniWindowMaxHeight {
		t.Fatalf("large mini bounds = %dx%d, want %dx%d",
			large.Width, large.Height, miniWindowMaxWidth, miniWindowMaxHeight)
	}
}

func TestFitMiniBoundsUsesPrimaryWorkArea(t *testing.T) {
	primary := screen(0, 0, 1920, 1080, true)
	primary.WorkArea = application.Rect{X: 0, Y: 0, Width: 1920, Height: 1040}
	secondary := screen(1920, 0, 1280, 1024, false)
	got, ok := fitMiniBounds(WindowBounds{}, false, []*application.Screen{secondary, primary})
	if !ok {
		t.Fatal("expected mini bounds")
	}
	if got.Y != 1040-miniWindowHeight-miniWindowMargin {
		t.Fatalf("mini Y = %d, want the primary work area bottom", got.Y)
	}
	if got.X != 1920-miniWindowWidth-miniWindowMargin {
		t.Fatalf("mini X = %d, want the primary work area right edge", got.X)
	}
}
