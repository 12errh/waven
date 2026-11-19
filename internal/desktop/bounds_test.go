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
