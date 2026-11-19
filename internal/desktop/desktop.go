package desktop

import (
	"log"
	"os"
	"runtime"
	"sync"
	"sync/atomic"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/icons"
)

// Window sizing. The window is sized to the usable area of the primary
// display, so it never opens wider or taller than the desktop.
const (
	defaultWindowWidth  = 1280
	defaultWindowHeight = 820
	minimumWindowWidth  = 960
	minimumWindowHeight = 640
	windowEdgeMargin    = 16
)

// Desktop owns the native window shell: the frameless WAVEN window and its
// system tray presence. It keeps the process alive when the window is closed so
// music can keep playing in the tray.
type Desktop struct {
	app           *application.App
	window        *application.WebviewWindow
	tray          *application.SystemTray
	trayLock      sync.Mutex
	trayTrack     *application.MenuItem
	trayPlayPause *application.MenuItem
	nowPlaying    PlayerState
	quitting      atomic.Bool
	trayAvailable atomic.Bool
}

func New(app *application.App) *Desktop {
	return &Desktop{app: app}
}

func (d *Desktop) Start() {
	d.createWindow()

	// The tray icon is only visible when the desktop provides a
	// StatusNotifierItem host. Without one, closing the window must quit
	// instead of hiding an app the user has no way to restore. Wails watches
	// for the host on its own once the tray exists, so a host that starts
	// later still gets the icon.
	watchTrayHost(func(available bool) {
		d.trayAvailable.Store(available)
		if available {
			d.debugf("tray: StatusNotifier host available")
			d.ensureTray()
			return
		}
		log.Printf("tray: no StatusNotifier host; the window quits on close")
	})

	// Window size can only be validated once the platform has cached the
	// connected displays. Give the first frame a beat, then fit the shell to
	// the primary display's work area.
	d.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		time.AfterFunc(200*time.Millisecond, d.fitToScreen)
	})

	if os.Getenv("WAVEN_SMOKE") == "1" {
		go d.smokeTest()
	}
}

func (d *Desktop) createWindow() {
	backgroundType := application.BackgroundTypeTransparent
	if runtime.GOOS == "windows" {
		// Windows needs the translucent type for Mica/Acrylic backdrops.
		backgroundType = application.BackgroundTypeTranslucent
	}

	window := d.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "WAVEN",
		Width:            defaultWindowWidth,
		Height:           defaultWindowHeight,
		MinWidth:         minimumWindowWidth,
		MinHeight:        minimumWindowHeight,
		Frameless:        true,
		BackgroundType:   backgroundType,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		InitialPosition:  application.WindowCentered,
		Mac: application.MacWindow{
			Backdrop:                application.MacBackdropTranslucent,
			CornerType:              application.MacWindowCornerTypeRounded,
			CornerRadius:            28,
			InvisibleTitleBarHeight: 40,
		},
		Windows: application.WindowsWindow{
			BackdropType: application.Acrylic,
			Theme:        application.Dark,
		},
		Linux: application.LinuxWindow{
			WindowIsTranslucent: true,
			WebviewGpuPolicy:    application.WebviewGpuPolicyAlways,
			Icon:                appIcon,
		},
	})

	// Closing the window means "hide to tray", not "quit". The tray's Quit
	// action sets the flag first so the process can actually terminate.
	// Desktops without a StatusNotifierItem host have no tray to restore from,
	// so in that case close quits the app instead of hiding it forever.
	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		if d.quitting.Load() {
			return
		}
		if !d.trayAvailable.Load() {
			log.Printf("window closing: no system tray host; quitting")
			event.Cancel()
			go d.Quit()
			return
		}
		d.debugf("window closing: hiding to tray")
		window.Hide()
		event.Cancel()
	})

	d.registerDiagnosticHooks(window)
	d.window = window
}

func (d *Desktop) ensureTray() {
	d.trayLock.Lock()
	defer d.trayLock.Unlock()
	if d.tray != nil {
		return
	}
	d.createTray()
}

// createTray builds the tray menu and registers the icon. The caller must hold
// trayLock (or be the single-threaded startup path).
func (d *Desktop) createTray() {
	tray := d.app.SystemTray.New()

	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	} else {
		tray.SetIcon(trayIcon)
	}
	tray.SetTooltip("WAVEN")

	menu := d.app.NewMenu()
	title := menu.Add("WAVEN")
	title.SetEnabled(false)
	d.trayTrack = menu.Add("Nothing playing")
	d.trayTrack.SetEnabled(false)
	menu.AddSeparator()
	d.trayPlayPause = menu.Add("Play")
	d.trayPlayPause.OnClick(func(*application.Context) {
		d.app.Event.Emit("tray:playPause")
	})
	menu.Add("Previous").OnClick(func(*application.Context) {
		d.app.Event.Emit("tray:prev")
	})
	menu.Add("Next").OnClick(func(*application.Context) {
		d.app.Event.Emit("tray:next")
	})
	menu.AddSeparator()
	menu.Add("Open WAVEN").OnClick(func(*application.Context) {
		d.Show()
	})
	menu.Add("Hide WAVEN").OnClick(func(*application.Context) {
		d.Hide()
	})
	menu.AddSeparator()
	menu.Add("Quit WAVEN").OnClick(func(*application.Context) {
		d.Quit()
	})
	tray.SetMenu(menu)
	tray.OnClick(func() {
		d.debugf("tray activate")
		d.Toggle()
	})

	d.tray = tray
	d.applyNowPlayingLocked()
}

// SetNowPlaying updates the tray's track and transport labels. It is called by
// the Player service whenever the frontend reports a track or play-state
// change, including before the tray exists (the cached state is applied when
// the tray is created later).
func (d *Desktop) SetNowPlaying(state PlayerState) {
	d.trayLock.Lock()
	defer d.trayLock.Unlock()
	d.nowPlaying = state
	d.applyNowPlayingLocked()
}

// applyNowPlayingLocked expects trayLock to be held.
func (d *Desktop) applyNowPlayingLocked() {
	label := "Nothing playing"
	if d.nowPlaying.Title != "" {
		label = d.nowPlaying.Title
		if d.nowPlaying.Artist != "" {
			label += " — " + d.nowPlaying.Artist
		}
	}
	if d.trayTrack != nil {
		d.trayTrack.SetLabel(label)
	}
	if d.trayPlayPause != nil {
		if d.nowPlaying.Playing {
			d.trayPlayPause.SetLabel("Pause")
		} else {
			d.trayPlayPause.SetLabel("Play")
		}
	}
	if d.tray != nil {
		d.tray.SetTooltip("WAVEN\n" + label)
	}
}

// Show restores and focuses the main window.
func (d *Desktop) Show() {
	if d.window == nil {
		return
	}
	d.window.UnMinimise()
	d.window.Show()
	d.window.Focus()
}

// Hide sends the window to the tray.
func (d *Desktop) Hide() {
	if d.window == nil {
		return
	}
	d.window.Hide()
}

// Toggle hides a focused window or restores a hidden, minimised, or unfocused
// one. Focus is the reliable signal here: GTK/Wayland does not always report
// GDK_TOPLEVEL_STATE_MINIMIZED, so IsMinimised alone would hide an already
// minimised window when the tray icon is clicked.
func (d *Desktop) Toggle() {
	if d.window == nil {
		return
	}
	if d.window.IsVisible() && d.window.IsFocused() {
		d.Hide()
		return
	}
	d.Show()
}

// Quit exits the process, including any playback running in the background.
func (d *Desktop) Quit() {
	d.quitting.Store(true)
	d.app.Quit()
}

// fitToScreen keeps the default window size on large displays, but shrinks it
// to the primary display's work area on small laptop screens. The platform can
// take a moment to report its displays, so this waits for the screen manager to
// become ready instead of trusting the first frame.
func (d *Desktop) fitToScreen() {
	if d.window == nil {
		return
	}

	deadline := time.Now().Add(8 * time.Second)
	for {
		if screen := d.app.Screen.GetPrimary(); screen != nil {
			d.applyWindowBounds(screen)
			return
		}
		if time.Now().After(deadline) {
			d.debugf("primary screen unavailable; keeping default window size")
			return
		}
		time.Sleep(150 * time.Millisecond)
	}
}

func (d *Desktop) applyWindowBounds(screen *application.Screen) {
	width, height := defaultWindowWidth, defaultWindowHeight
	area := screen.WorkArea
	d.debugf("primary screen %q work area %dx%d at %d,%d", screen.Name, area.Width, area.Height, area.X, area.Y)
	if area.Width > 0 {
		if maxWidth := area.Width - 2*windowEdgeMargin; maxWidth > 0 && width > maxWidth {
			width = maxWidth
		}
	}
	if area.Height > 0 {
		if maxHeight := area.Height - 2*windowEdgeMargin; maxHeight > 0 && height > maxHeight {
			height = maxHeight
		}
	}

	width = max(width, minimumWindowWidth)
	height = max(height, minimumWindowHeight)

	currentWidth, currentHeight := d.window.Size()
	if currentWidth != width || currentHeight != height {
		d.debugf("resizing window from %dx%d to %dx%d", currentWidth, currentHeight, width, height)
		d.window.SetSize(width, height)
	}
	d.window.Center()
}

// smokeTest exercises the window controls, close-to-hide, and restore when
// WAVEN_SMOKE=1. It is a development aid used to verify the desktop shell on a
// real display.
func (d *Desktop) smokeTest() {
	time.Sleep(8 * time.Second)

	// Probe the live page: hydration, Wails runtime readiness, and the CSS drag
	// contract used by the header.
	d.window.ExecJS(`(() => {
		const header = document.querySelector('.wails-drag');
		const draggable = header ? getComputedStyle(header).getPropertyValue('--wails-draggable').trim() : 'missing';
		const runtime = typeof window._wails?.handleDragEnter === 'function' ? 'ready' : 'missing';
		fetch('/waven-probe?state=' + document.readyState + '&runtime=' + runtime + '&draggable=' + encodeURIComponent(draggable));
	})()`)
	time.Sleep(500 * time.Millisecond)

	// Synthesise a header press/move/release. The Wails debug log should show
	// the resulting wails:drag message, which is what the native move is driven
	// by. Linux ignores presses whose detail is not 1.
	d.window.ExecJS(`(() => {
		const header = document.querySelector('.wails-drag');
		if (!header) return;
		const rect = header.getBoundingClientRect();
		const base = { bubbles: true, cancelable: true, clientX: rect.left + 80, clientY: rect.top + 16, button: 0, detail: 1 };
		header.dispatchEvent(new MouseEvent('mousedown', { ...base, buttons: 1 }));
		window.dispatchEvent(new MouseEvent('mousemove', { ...base, clientX: base.clientX + 40, buttons: 1 }));
		window.dispatchEvent(new MouseEvent('mouseup', { ...base, clientX: base.clientX + 40, buttons: 0 }));
	})()`)
	time.Sleep(500 * time.Millisecond)

	// Verify that the appearance control updates the DOM and persists the
	// choice. The probe appears in the dev log alongside the other smoke data.
	log.Printf("smoke: switching to the solid appearance")
	d.window.ExecJS(`document.querySelector('[aria-label="Solid background fallback"]')?.click()`)
	time.Sleep(400 * time.Millisecond)
	d.window.ExecJS(`(() => {
		const app = document.querySelector('.waven-app');
		const mode = app?.dataset.windowMode ?? 'missing';
		const stored = localStorage.getItem('waven_window_mode_v1') ?? 'missing';
		fetch('/waven-probe?mode=' + encodeURIComponent(mode) + '&stored=' + encodeURIComponent(stored));
	})()`)
	time.Sleep(500 * time.Millisecond)
	log.Printf("smoke: restoring the glass appearance")
	d.window.ExecJS(`document.querySelector('[aria-label="Glass with ambient tint from the current cover"]')?.click()`)
	time.Sleep(300 * time.Millisecond)

	log.Printf("smoke: clicking the minimise control")
	d.window.ExecJS(`document.querySelector('[aria-label="Minimise window"]')?.click()`)
	time.Sleep(1500 * time.Millisecond)
	log.Printf("smoke: after minimise: visible=%v minimised=%v", d.window.IsVisible(), d.window.IsMinimised())

	d.Show()
	time.Sleep(time.Second)
	log.Printf("smoke: visible after restore: %v, minimised: %v", d.window.IsVisible(), d.window.IsMinimised())

	if !d.trayAvailable.Load() {
		log.Printf("smoke: no tray host; skipping the hide-to-tray test")
		log.Printf("smoke: clicking close (the process should quit)")
		d.window.ExecJS(`document.querySelector('[aria-label="Close WAVEN"]')?.click()`)
		time.Sleep(2 * time.Second)
		log.Printf("smoke: still running after close")
		d.Quit()
		return
	}

	log.Printf("smoke: clicking the hide-to-tray control")
	d.window.ExecJS(`document.querySelector('[aria-label="Close WAVEN"]')?.click()`)
	time.Sleep(1500 * time.Millisecond)
	log.Printf("smoke: visible after UI close: %v", d.window.IsVisible())

	// Activate the tray item the same way a panel does. This verifies the item
	// is registered and that a tray click restores the window.
	if err := activateTray(); err != nil {
		log.Printf("smoke: tray activation failed: %v", err)
	} else {
		log.Printf("smoke: tray activation issued")
	}
	time.Sleep(1500 * time.Millisecond)
	log.Printf("smoke: visible after tray activation: %v", d.window.IsVisible())

	// A tray click must also restore a window the user minimised. The toggle
	// uses focus rather than the unreliable Wayland minimise state, so wait for
	// the compositor to report the focus change. When it ignores the minimise
	// request, there is nothing to restore and the check is skipped.
	log.Printf("smoke: minimising before the second tray activation")
	d.window.ExecJS(`document.querySelector('[aria-label="Minimise window"]')?.click()`)
	deadline := time.Now().Add(5 * time.Second)
	for d.window.IsFocused() && time.Now().Before(deadline) {
		time.Sleep(200 * time.Millisecond)
	}
	if d.window.IsFocused() {
		log.Printf("smoke: window stayed focused after minimise; skipping the minimised tray check")
		d.Quit()
		return
	}
	log.Printf("smoke: before tray activation: visible=%v focused=%v", d.window.IsVisible(), d.window.IsFocused())

	if err := activateTray(); err != nil {
		log.Printf("smoke: tray activation failed: %v", err)
	} else {
		log.Printf("smoke: tray activation issued")
	}
	time.Sleep(1500 * time.Millisecond)
	log.Printf("smoke: after tray activation: visible=%v focused=%v", d.window.IsVisible(), d.window.IsFocused())
	d.Quit()
}

func (d *Desktop) registerDiagnosticHooks(window *application.WebviewWindow) {
	if os.Getenv("WAVEN_DEBUG") != "1" {
		return
	}
	window.RegisterHook(events.Common.WindowShow, func(*application.WindowEvent) {
		log.Printf("debug: window shown")
	})
	window.RegisterHook(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		log.Printf("debug: frontend runtime ready")
	})
	window.RegisterHook(events.Common.WindowHide, func(*application.WindowEvent) {
		log.Printf("debug: window hidden")
	})
	window.RegisterHook(events.Common.WindowMinimise, func(*application.WindowEvent) {
		log.Printf("debug: window minimised")
	})
	window.RegisterHook(events.Common.WindowRestore, func(*application.WindowEvent) {
		log.Printf("debug: window restored")
	})
	window.RegisterHook(events.Common.WindowFocus, func(*application.WindowEvent) {
		log.Printf("debug: window focused")
	})
	window.RegisterHook(events.Common.WindowLostFocus, func(*application.WindowEvent) {
		log.Printf("debug: window lost focus")
	})
}

func (d *Desktop) debugf(format string, args ...any) {
	if os.Getenv("WAVEN_DEBUG") == "1" {
		log.Printf(format, args...)
	}
}
