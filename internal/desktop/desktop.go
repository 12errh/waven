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
	trayLabel     string
	quitting      atomic.Bool
	started       atomic.Bool
	trayAvailable atomic.Bool
	maximized     atomic.Bool

	settings    *SettingsService
	library     *LibraryService
	startHidden bool

	boundsLock   sync.Mutex
	normalBounds application.Rect
	boundsTimer  *time.Timer
}

// New wires the desktop shell to the persisted settings. startHidden is true
// when the process was launched with --hidden; the saved app.startHidden
// preference is applied inside Start.
func New(app *application.App, settings *SettingsService, library *LibraryService, startHidden bool) *Desktop {
	return &Desktop{app: app, settings: settings, library: library, startHidden: startHidden}
}

func (d *Desktop) Start() {
	if d.settings != nil && d.settings.startHidden() {
		d.startHidden = true
	}
	d.createWindow()
	d.debugf("created window hidden=%v visible=%v", d.startHidden, d.window.IsVisible())

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
		if d.startHidden {
			// --hidden (or app.startHidden) without a tray would strand the
			// process invisible. Show the window instead; before the event loop
			// starts this is deferred to ApplicationStarted so the saved bounds
			// are applied before the first map.
			log.Printf("tray: no StatusNotifier host; showing the window for --hidden")
			d.showAfterTrayLoss()
		} else {
			log.Printf("tray: no StatusNotifier host; the window quits on close")
		}
	})

	// Window size and placement can only be validated once the platform has
	// cached the connected displays. Give the first frame a beat, then restore
	// the saved bounds against the monitors that are actually present. If the
	// app started hidden and no tray host exists to restore it, present it only
	// after the bounds are in place: mapping the oversized default window first
	// makes compositors such as Mutter maximise it.
	d.app.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
		d.started.Store(true)
		time.AfterFunc(200*time.Millisecond, func() {
			d.restoreWindow()
			if d.startHidden && !d.trayAvailable.Load() {
				d.showAfterTrayLoss()
			}
		})
	})

	if os.Getenv("WAVEN_SMOKE") == "1" {
		go d.smokeTest()
	}
}

// nativeWindowAppearance returns the native window options that let every CSS
// appearance mode work. The window is always transparent (or translucent where
// the platform supports a real backdrop), so switching between Glass, Pure,
// and Solid is a CSS change that takes effect immediately instead of needing a
// restart. Platform fallbacks follow docs/desktop-plan.md §8.2: Windows 10
// gets a transparent window with no blur, Windows 11 22H2+ gets Acrylic,
// macOS uses Liquid Glass (with a translucent fallback in Wails), and Linux
// relies on the compositor.
func nativeWindowAppearance() (
	application.BackgroundType,
	application.RGBA,
	application.MacBackdrop,
	application.BackdropType,
	bool,
) {
	backgroundColour := application.NewRGBA(0, 0, 0, 0)
	if runtime.GOOS == "windows" {
		if windowsSupportsAcrylic() {
			return application.BackgroundTypeTranslucent,
				backgroundColour,
				application.MacBackdropTranslucent,
				application.Acrylic,
				true
		}
		return application.BackgroundTypeTransparent,
			backgroundColour,
			application.MacBackdropTransparent,
			application.None,
			true
	}
	if runtime.GOOS == "darwin" {
		return application.BackgroundTypeTransparent,
			backgroundColour,
			application.MacBackdropLiquidGlass,
			application.None,
			true
	}
	return application.BackgroundTypeTransparent,
		backgroundColour,
		application.MacBackdropTransparent,
		application.None,
		true
}

func (d *Desktop) createWindow() {
	backgroundType, backgroundColour, macBackdrop, windowsBackdrop, translucent := nativeWindowAppearance()

	window := d.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "main",
		Title:            "WAVEN",
		Width:            defaultWindowWidth,
		Height:           defaultWindowHeight,
		MinWidth:         minimumWindowWidth,
		MinHeight:        minimumWindowHeight,
		Frameless:        true,
		Hidden:           d.startHidden,
		EnableFileDrop:   true,
		BackgroundType:   backgroundType,
		BackgroundColour: backgroundColour,
		InitialPosition:  application.WindowCentered,
		Mac: application.MacWindow{
			Backdrop:                macBackdrop,
			CornerType:              application.MacWindowCornerTypeRounded,
			CornerRadius:            28,
			InvisibleTitleBarHeight: 40,
		},
		Windows: application.WindowsWindow{
			BackdropType: windowsBackdrop,
			Theme:        application.Dark,
		},
		Linux: application.LinuxWindow{
			WindowIsTranslucent: translucent,
			WebviewGpuPolicy:    application.WebviewGpuPolicyAlways,
			Icon:                appIcon,
		},
	})

	// Closing the window means "hide to tray", not "quit", unless the user
	// turned that off or there is no tray to restore from. The tray's Quit
	// action sets the flag first so the process can actually terminate.
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
		if d.settings != nil && !d.settings.closeToTray() {
			log.Printf("window closing: close-to-tray is off; quitting")
			event.Cancel()
			go d.Quit()
			return
		}
		d.debugf("window closing: hiding to tray")
		d.Hide()
		event.Cancel()
	})

	d.registerWindowStateHooks(window)
	d.registerDiagnosticHooks(window)

	// A drop is handled in Go so a scan starts even if the frontend is busy or
	// reloading. The frontend listens for "library:drop" to refresh its folder
	// list and surface the outcome.
	window.OnWindowEvent(events.Common.WindowFilesDropped, func(event *application.WindowEvent) {
		d.handleFileDrop(event.Context().DroppedFiles())
	})

	d.window = window
}

// DropOutcome reports the result of a native file drop that has already been
// registered with the library. The frontend uses it for a toast and refresh.
type DropOutcome struct {
	Result      FolderImportResult `json:"result"`
	Error       string             `json:"error,omitempty"`
	ScanStarted bool               `json:"scanStarted"`
}

func (d *Desktop) handleFileDrop(paths []string) {
	if d.library == nil || len(paths) == 0 {
		return
	}
	go func() {
		result, err := d.library.ImportDroppedPaths(paths)
		outcome := DropOutcome{Result: result}
		if err != nil {
			outcome.Error = err.Error()
		}
		if len(result.Added) > 0 {
			if scanErr := d.library.Rescan(0); scanErr != nil {
				// A scan already in flight is not a failed drop; tell the user
				// the folders were added and the current scan will include them
				// on its next pass.
				outcome.Result.Warnings = append(outcome.Result.Warnings, scanErr.Error())
			} else {
				outcome.ScanStarted = true
			}
		}
		if d.app != nil {
			d.app.Event.Emit("library:drop", outcome)
		}
	}()
}

// registerWindowStateHooks records the normal window placement after a move or
// resize and keeps the maximised flag separate. Writes are debounced because a
// drag emits a move for every pointer step.
func (d *Desktop) registerWindowStateHooks(window *application.WebviewWindow) {
	window.RegisterHook(events.Common.WindowDidMove, func(*application.WindowEvent) {
		d.scheduleSaveBounds(450 * time.Millisecond)
	})
	window.RegisterHook(events.Common.WindowDidResize, func(*application.WindowEvent) {
		d.scheduleSaveBounds(450 * time.Millisecond)
	})
	window.RegisterHook(events.Common.WindowMaximise, func(*application.WindowEvent) {
		width, height := window.Size()
		d.boundsLock.Lock()
		normal := d.normalBounds
		d.boundsLock.Unlock()
		if normal.Width == width && normal.Height == height {
			// Mutter marks a window that exactly fills the work area as
			// maximised when it is mapped, even though the geometry did not
			// change and the user did not ask for it. Undo the flag so the next
			// launch still opens the saved normal size.
			d.debugf("ignoring map-time maximise at %dx%d", width, height)
			time.AfterFunc(50*time.Millisecond, func() {
				if window.IsMaximised() {
					window.UnMaximise()
				}
			})
			return
		}
		d.debugf("window maximised: size=%dx%d", width, height)
		d.maximized.Store(true)
		d.scheduleSaveBounds(50 * time.Millisecond)
	})
	window.RegisterHook(events.Common.WindowUnMaximise, func(*application.WindowEvent) {
		d.debugf("window unmaximised")
		d.maximized.Store(false)
		d.scheduleSaveBounds(250 * time.Millisecond)
	})
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
	menu.Add("Show WAVEN").OnClick(func(*application.Context) {
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
	if label != d.trayLabel {
		d.trayLabel = label
		d.debugf("tray track: %s", label)
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

// showAfterTrayLoss reveals a window that was meant to start hidden when no
// StatusNotifier host is available to restore it. Before Wails starts, the
// show is skipped: ApplicationStarted calls this again once the saved bounds
// have been applied, so the first map is already the right size.
func (d *Desktop) showAfterTrayLoss() {
	if !d.started.Load() || d.quitting.Load() {
		return
	}
	width, height := d.window.Size()
	d.debugf("showing without a tray: size=%dx%d maximised=%v", width, height, d.window.IsMaximised())
	d.Show()
	width, height = d.window.Size()
	d.debugf("shown without a tray: size=%dx%d maximised=%v", width, height, d.window.IsMaximised())
}

// Hide sends the window to the tray. Placement is saved first so closing right
// after a drag never loses the last position to a pending debounce.
func (d *Desktop) Hide() {
	if d.window == nil {
		return
	}
	d.saveBoundsNow()
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
	d.saveBoundsNow()
	d.quitting.Store(true)
	d.app.Quit()
}

// restoreWindow applies the saved placement after validating it against the
// monitors that are currently connected. A window saved on a disconnected
// display is centered on the primary display instead of opening off-screen.
func (d *Desktop) restoreWindow() {
	if d.window == nil {
		return
	}

	deadline := time.Now().Add(8 * time.Second)
	for {
		screens := d.app.Screen.GetAll()
		if len(screens) > 0 {
			saved, hasSaved := WindowBounds{}, false
			if d.settings != nil {
				saved, hasSaved = d.settings.windowBounds()
			}
			rect, ok := fitWindowBounds(
				saved,
				hasSaved,
				screens,
				defaultWindowWidth,
				defaultWindowHeight,
				minimumWindowWidth,
				minimumWindowHeight,
			)
			if !ok {
				d.fitToScreen()
				return
			}
			d.debugf("restoring window bounds %dx%d at %d,%d (saved=%v maximized=%v) visible=%v",
				rect.Width, rect.Height, rect.X, rect.Y, hasSaved, hasSaved && saved.Maximized, d.window.IsVisible())
			d.setNormalBounds(rect)
			d.maximized.Store(hasSaved && saved.Maximized)
			d.window.SetBounds(rect)
			d.debugf("restored bounds visible=%v", d.window.IsVisible())
			if hasSaved && saved.Maximized {
				d.window.Maximise()
			} else if d.window.IsMaximised() {
				// Some compositors auto-maximise a window that fills the work
				// area while it maps. The saved state is normal, so undo it.
				d.window.UnMaximise()
			}
			return
		}
		if time.Now().After(deadline) {
			d.debugf("primary screen unavailable; keeping default window size")
			return
		}
		time.Sleep(150 * time.Millisecond)
	}
}

// fitToScreen keeps the default window size on large displays, but shrinks it
// to the primary display's work area on small laptop screens. It is the
// fallback when the screen manager cannot report a display.
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
	x, y := d.window.Position()
	d.setNormalBounds(application.Rect{X: x, Y: y, Width: width, Height: height})
}

func (d *Desktop) setNormalBounds(bounds application.Rect) {
	d.boundsLock.Lock()
	d.normalBounds = bounds
	d.boundsLock.Unlock()
}

func (d *Desktop) scheduleSaveBounds(delay time.Duration) {
	d.boundsLock.Lock()
	if d.boundsTimer != nil {
		d.boundsTimer.Stop()
	}
	d.boundsTimer = time.AfterFunc(delay, d.saveBoundsNow)
	d.boundsLock.Unlock()
}

// saveBoundsNow persists the normal placement and the maximised flag. The flag
// is tracked from maximise/unmaximise events instead of IsMaximised(): some
// compositors report a window that fills the work area as maximised even
// though the user never asked for it. While maximised, Bounds() reports the
// maximised frame, so the last normal bounds are kept instead.
func (d *Desktop) saveBoundsNow() {
	if d.window == nil || d.settings == nil {
		return
	}

	maximized := d.maximized.Load()
	if !maximized && !d.window.IsMaximised() {
		bounds := d.window.Bounds()
		if bounds.Width > 0 && bounds.Height > 0 {
			d.setNormalBounds(bounds)
		}
	}

	d.boundsLock.Lock()
	normal := d.normalBounds
	d.boundsLock.Unlock()
	if normal.Width <= 0 || normal.Height <= 0 {
		return
	}

	saved := WindowBounds{
		X:         normal.X,
		Y:         normal.Y,
		Width:     normal.Width,
		Height:    normal.Height,
		Maximized: maximized,
	}
	if err := d.settings.saveWindowBounds(saved); err != nil {
		log.Printf("save window bounds: %v", err)
	}
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

	// A seeded library proves that playback survives hiding to the tray. The
	// test data path is opt-in so the normal smoke run does not depend on
	// files outside the app.
	audioSmoke := os.Getenv("WAVEN_SMOKE_LIBRARY") == "1"
	probeAudio := func(stage string) {
		if !audioSmoke {
			return
		}
		d.window.ExecJS(`(() => {
			const seek = document.querySelector('[aria-label="Seek track progress"]');
			const pause = document.querySelector('[aria-label="Pause playback"]');
			const track = document.querySelector('section[aria-label="Track list"] button[aria-label^="Pause "]');
			fetch('/waven-probe?audio=` + stage + `&playing=' + (pause ? 'yes' : 'no') +
				'&position=' + encodeURIComponent(seek?.getAttribute('aria-valuenow') ?? 'missing') +
				'&track=' + encodeURIComponent(track?.getAttribute('aria-label') ?? 'none'));
		})()`)
		time.Sleep(400 * time.Millisecond)
	}
	if audioSmoke {
		log.Printf("smoke: scanning the seeded library")
		d.window.ExecJS(`document.querySelector('[aria-label="Music library and folders"]')?.click()`)
		time.Sleep(700 * time.Millisecond)
		d.window.ExecJS(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Rescan all'))?.click()`)
		time.Sleep(3 * time.Second)

		log.Printf("smoke: starting playback from the library")
		d.window.ExecJS(`document.querySelector('[aria-label="Home"]')?.click()`)
		time.Sleep(1200 * time.Millisecond)
		d.window.ExecJS(`document.querySelector('section[aria-label="Track list"] button[aria-label^="Play "]')?.click()`)
		time.Sleep(2500 * time.Millisecond)
		probeAudio("started")

		log.Printf("smoke: tray play/pause")
		d.app.Event.Emit("tray:playPause")
		time.Sleep(900 * time.Millisecond)
		probeAudio("pausedFromTray")
		d.app.Event.Emit("tray:playPause")
		time.Sleep(900 * time.Millisecond)
		probeAudio("resumedFromTray")
	}

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

	// A user-driven maximise must persist as a maximise flag, and restoring
	// must clear it again. This runs while the page is visible so it exercises
	// the same toggle the header button uses.
	log.Printf("smoke: maximising the window")
	d.window.ExecJS(`document.querySelector('[aria-label="Maximise or restore window"]')?.click()`)
	time.Sleep(1500 * time.Millisecond)
	saved, _ := d.settings.windowBounds()
	log.Printf("smoke: maximised=%v savedMaximized=%v", d.window.IsMaximised(), saved.Maximized)
	d.window.ExecJS(`document.querySelector('[aria-label="Maximise or restore window"]')?.click()`)
	time.Sleep(1500 * time.Millisecond)
	saved, _ = d.settings.windowBounds()
	log.Printf("smoke: restored maximised=%v savedMaximized=%v", d.window.IsMaximised(), saved.Maximized)

	// Open Settings through the profile avatar. The probe verifies that the
	// folder, appearance, playback, and about sections rendered from the shared
	// components rather than the old profile-only view.
	log.Printf("smoke: opening settings")
	d.window.ExecJS(`document.querySelector('[aria-label="Listener profile and settings"]')?.click()`)
	time.Sleep(800 * time.Millisecond)
	d.window.ExecJS(`(() => {
		const text = document.body.innerText;
		const open = text.includes('About WAVEN') && text.includes('Library folders');
		const toggles = document.querySelectorAll('[role="switch"]').length;
		const radios = document.querySelectorAll('[role="radio"]').length;
		fetch('/waven-probe?settings=' + (open ? 'open' : 'missing') + '&toggles=' + toggles + '&radios=' + radios);
	})()`)
	time.Sleep(500 * time.Millisecond)

	// Exercise the real Settings binding: the toggle is optimistic, then the
	// Go service writes app.autostart and the login entry. With a tray host,
	// "Start hidden" is enabled too; turning it on must rewrite the autostart
	// entry with --hidden.
	if d.trayAvailable.Load() {
		log.Printf("smoke: enabling start hidden from settings")
		d.window.ExecJS(`document.querySelector('[role="switch"][aria-label="Start hidden"]')?.click()`)
		time.Sleep(900 * time.Millisecond)
	}
	log.Printf("smoke: enabling autostart from settings")
	d.window.ExecJS(`document.querySelector('[role="switch"][aria-label="Launch at login"]')?.click()`)
	time.Sleep(1200 * time.Millisecond)
	d.window.ExecJS(`(() => {
		const toggle = document.querySelector('[role="switch"][aria-label="Launch at login"]');
		const app = document.querySelector('.waven-app');
		fetch('/waven-probe?autostart=' + encodeURIComponent(toggle?.getAttribute('aria-checked') ?? 'missing') + '&settingsMode=' + encodeURIComponent(app?.dataset.windowMode ?? 'missing'));
	})()`)
	time.Sleep(500 * time.Millisecond)

	log.Printf("smoke: returning to Discover")
	d.window.ExecJS(`Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.includes('Back to Discover'))?.click()`)
	time.Sleep(800 * time.Millisecond)

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
	probeAudio("beforeHide")
	d.window.ExecJS(`document.querySelector('[aria-label="Close WAVEN"]')?.click()`)
	time.Sleep(1500 * time.Millisecond)
	log.Printf("smoke: visible after UI close: %v", d.window.IsVisible())
	time.Sleep(2500 * time.Millisecond)
	probeAudio("afterHide")

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
		log.Printf("debug: frontend runtime ready visible=%v", window.IsVisible())
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
