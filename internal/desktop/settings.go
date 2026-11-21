package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"sync"

	"waven/internal/store"
)

// Version is the user-facing application version. Release builds can override
// it with -ldflags "-X waven/internal/desktop.Version=...".
var Version = "0.1.0"

const (
	settingWindowMode      = "window.mode"
	settingWindowBounds    = "window.bounds"
	settingMiniBounds      = "window.miniBounds"
	settingCloseToTray     = "app.closeToTray"
	settingStartHidden     = "app.startHidden"
	settingAutostart       = "app.autostart"
	settingAlwaysOnTopMini = "app.alwaysOnTopMini"
	settingUILayout        = "ui.layout"

	layoutSplitMin = 35
	layoutSplitMax = 75
)

// LayoutSettings stores the user's shell arrangement. Positions are validated
// on read and write so a hand-edited database row can never break the shell.
type LayoutSettings struct {
	DockPosition string `json:"dockPosition"`
	DockExpanded bool   `json:"dockExpanded"`
	NavPosition  string `json:"navPosition"`
	HeroPosition string `json:"heroPosition"`
	Split        int    `json:"split"`
}

// AppSettings is the user-editable desktop configuration. Window bounds are
// stored separately because the shell writes them automatically.
type AppSettings struct {
	WindowMode      string         `json:"windowMode"`
	CloseToTray     bool           `json:"closeToTray"`
	StartHidden     bool           `json:"startHidden"`
	Autostart       bool           `json:"autostart"`
	AlwaysOnTopMini bool           `json:"alwaysOnTopMini"`
	Layout          LayoutSettings `json:"layout"`
}

// AppInfo is read-only information for the About section.
type AppInfo struct {
	Version            string `json:"version"`
	Platform           string `json:"platform"`
	DataDir            string `json:"dataDir"`
	CacheDir           string `json:"cacheDir"`
	TrayAvailable      bool   `json:"trayAvailable"`
	AutostartSupported bool   `json:"autostartSupported"`
}

// SettingsService stores appearance, window, and startup preferences in the
// shared SQLite database. The shell reads the same rows at launch before the
// window is created.
type SettingsService struct {
	store *store.Store

	// applyAutostart is a seam for tests so a settings round-trip never writes
	// to the real login items of the machine running the tests.
	applyAutostart func(enabled, startHidden bool) error

	// apply is called after a successful write so the shell can react to a
	// preference that affects the live window (the mini player stays on top).
	// It must not call back into the settings service, which still holds mu.
	apply func(settings AppSettings)

	// mu serialises updates so two quick toggles cannot interleave their
	// autostart writes.
	mu sync.Mutex
}

// NewSettingsService shares the library's database handle. Settings are
// written before the Library closes on shutdown.
func NewSettingsService(library *LibraryService) (*SettingsService, error) {
	if library == nil || library.store == nil {
		return nil, errors.New("settings: library store is required")
	}
	return &SettingsService{store: library.store, applyAutostart: setAutostart}, nil
}

func (s *SettingsService) updateAutostart(enabled, startHidden bool) error {
	if s.applyAutostart == nil {
		return setAutostart(enabled, startHidden)
	}
	return s.applyAutostart(enabled, startHidden)
}

// SetApplyHook registers the shell callback that applies live window
// preferences. It is wired in main once the desktop shell exists.
func (s *SettingsService) SetApplyHook(hook func(settings AppSettings)) {
	s.mu.Lock()
	s.apply = hook
	s.mu.Unlock()
}

// ServiceName makes generated bindings call this service "Settings".
func (s *SettingsService) ServiceName() string { return "Settings" }

// Get returns the saved settings, filling in platform defaults for missing or
// invalid rows.
func (s *SettingsService) Get() (AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.readLocked()
}

// Update writes all user-editable settings and applies the autostart entry.
// If the login item cannot be written, the previous settings are restored so
// the database never claims autostart is on when it is not.
func (s *SettingsService) Update(next AppSettings) (AppSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	previous, err := s.readLocked()
	if err != nil {
		return AppSettings{}, err
	}

	next.WindowMode = normalizeWindowMode(next.WindowMode)
	next.Layout = normalizeLayoutSettings(next.Layout)
	if err := s.writeLocked(next); err != nil {
		return AppSettings{}, err
	}
	if next.Autostart == previous.Autostart && next.StartHidden == previous.StartHidden {
		s.applyLocked(next)
		return next, nil
	}
	if err := s.updateAutostart(next.Autostart, next.StartHidden); err != nil {
		if rollbackErr := s.writeLocked(previous); rollbackErr != nil {
			return previous, fmt.Errorf("update autostart: %w (rollback failed: %v)", err, rollbackErr)
		}
		_ = s.updateAutostart(previous.Autostart, previous.StartHidden)
		s.applyLocked(previous)
		return previous, fmt.Errorf("update autostart: %w", err)
	}
	s.applyLocked(next)
	return next, nil
}

// applyLocked notifies the shell. The caller holds mu.
func (s *SettingsService) applyLocked(settings AppSettings) {
	if s.apply == nil {
		return
	}
	s.apply(settings)
}

func (s *SettingsService) readLocked() (AppSettings, error) {
	settings := defaultAppSettings()

	mode, ok, err := s.store.Setting(settingWindowMode)
	if err != nil {
		return settings, err
	}
	if ok {
		settings.WindowMode = normalizeWindowMode(mode)
	}

	settings.CloseToTray, err = s.readBoolLocked(settingCloseToTray, settings.CloseToTray)
	if err != nil {
		return settings, err
	}
	settings.StartHidden, err = s.readBoolLocked(settingStartHidden, settings.StartHidden)
	if err != nil {
		return settings, err
	}
	settings.Autostart, err = s.readBoolLocked(settingAutostart, settings.Autostart)
	if err != nil {
		return settings, err
	}
	settings.AlwaysOnTopMini, err = s.readBoolLocked(settingAlwaysOnTopMini, settings.AlwaysOnTopMini)
	if err != nil {
		return settings, err
	}
	settings.Layout = s.readLayoutLocked()
	return settings, nil
}

// readLayoutLocked decodes the layout JSON. Missing fields keep the defaults,
// and unknown positions fall back to the default arrangement.
func (s *SettingsService) readLayoutLocked() LayoutSettings {
	layout := defaultLayoutSettings()
	raw, ok, err := s.store.Setting(settingUILayout)
	if err != nil || !ok {
		return layout
	}
	if err := json.Unmarshal([]byte(raw), &layout); err != nil {
		return defaultLayoutSettings()
	}
	return normalizeLayoutSettings(layout)
}

func (s *SettingsService) readBoolLocked(key string, fallback bool) (bool, error) {
	raw, ok, err := s.store.Setting(key)
	if err != nil || !ok {
		return fallback, err
	}
	value, parseErr := strconv.ParseBool(raw)
	if parseErr != nil {
		return fallback, nil
	}
	return value, nil
}

func (s *SettingsService) writeLocked(settings AppSettings) error {
	encodedLayout, err := json.Marshal(settings.Layout)
	if err != nil {
		return fmt.Errorf("encode ui layout: %w", err)
	}
	rows := map[string]string{
		settingWindowMode:      settings.WindowMode,
		settingCloseToTray:     strconv.FormatBool(settings.CloseToTray),
		settingStartHidden:     strconv.FormatBool(settings.StartHidden),
		settingAutostart:       strconv.FormatBool(settings.Autostart),
		settingAlwaysOnTopMini: strconv.FormatBool(settings.AlwaysOnTopMini),
		settingUILayout:        string(encodedLayout),
	}
	for key, value := range rows {
		if err := s.store.SetSetting(key, value); err != nil {
			return fmt.Errorf("save %s: %w", key, err)
		}
	}
	return nil
}

func defaultAppSettings() AppSettings {
	return AppSettings{
		WindowMode:      platformDefaultWindowMode(),
		CloseToTray:     true,
		StartHidden:     false,
		Autostart:       false,
		AlwaysOnTopMini: true,
		Layout:          defaultLayoutSettings(),
	}
}

func defaultLayoutSettings() LayoutSettings {
	return LayoutSettings{
		DockPosition: "left",
		DockExpanded: false,
		NavPosition:  "top",
		HeroPosition: "right",
		Split:        58,
	}
}

func normalizeLayoutSettings(layout LayoutSettings) LayoutSettings {
	defaults := defaultLayoutSettings()
	switch layout.DockPosition {
	case "left", "right", "bottom":
	default:
		layout.DockPosition = defaults.DockPosition
	}
	switch layout.NavPosition {
	case "top", "bottom", "hidden":
	default:
		layout.NavPosition = defaults.NavPosition
	}
	switch layout.HeroPosition {
	case "left", "right", "bottom", "hidden":
	default:
		layout.HeroPosition = defaults.HeroPosition
	}
	if layout.Split < layoutSplitMin || layout.Split > layoutSplitMax {
		layout.Split = defaults.Split
	}
	return layout
}

// windowMode is read by the shell before creating the window.
func (s *SettingsService) windowMode() string {
	settings, err := s.Get()
	if err != nil {
		return platformDefaultWindowMode()
	}
	return normalizeWindowMode(settings.WindowMode)
}

// startHidden reports whether a normal launch should stay in the tray.
func (s *SettingsService) startHidden() bool {
	settings, err := s.Get()
	if err != nil {
		return false
	}
	return settings.StartHidden
}

// closeToTray reports whether the close button hides instead of quitting.
func (s *SettingsService) closeToTray() bool {
	settings, err := s.Get()
	if err != nil {
		return true
	}
	return settings.CloseToTray
}

func (s *SettingsService) windowBounds() (WindowBounds, bool) {
	return s.readBounds(settingWindowBounds)
}

func (s *SettingsService) saveWindowBounds(bounds WindowBounds) error {
	return s.saveBounds(settingWindowBounds, bounds)
}

// miniBounds returns the saved mini player placement, if the user ever used
// one. The shell falls back to the bottom-right corner of the primary display.
func (s *SettingsService) miniBounds() (WindowBounds, bool) {
	return s.readBounds(settingMiniBounds)
}

func (s *SettingsService) saveMiniBounds(bounds WindowBounds) error {
	return s.saveBounds(settingMiniBounds, bounds)
}

// alwaysOnTopMini reports whether the compact player should stay above other
// windows. It defaults to on so tray playback stays reachable.
func (s *SettingsService) alwaysOnTopMini() bool {
	settings, err := s.Get()
	if err != nil {
		return true
	}
	return settings.AlwaysOnTopMini
}

func (s *SettingsService) readBounds(key string) (WindowBounds, bool) {
	raw, ok, err := s.store.Setting(key)
	if err != nil || !ok {
		return WindowBounds{}, false
	}
	var bounds WindowBounds
	if err := json.Unmarshal([]byte(raw), &bounds); err != nil {
		return WindowBounds{}, false
	}
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return WindowBounds{}, false
	}
	return bounds, true
}

func (s *SettingsService) saveBounds(key string, bounds WindowBounds) error {
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return errors.New("window bounds must have a positive size")
	}
	encoded, err := json.Marshal(bounds)
	if err != nil {
		return fmt.Errorf("encode window bounds: %w", err)
	}
	return s.store.SetSetting(key, string(encoded))
}

// appPaths returns the database and artwork roots. WAVEN_DATA_DIR and
// WAVEN_CACHE_DIR keep tests and throwaway libraries away from real data.
func appPaths() (dataDir, cacheDir string) {
	dataDir = os.Getenv("WAVEN_DATA_DIR")
	if dataDir == "" {
		if config, err := os.UserConfigDir(); err == nil {
			dataDir = filepath.Join(config, "waven")
		}
	}
	cacheDir = os.Getenv("WAVEN_CACHE_DIR")
	if cacheDir == "" {
		if cache, err := os.UserCacheDir(); err == nil {
			cacheDir = filepath.Join(cache, "waven")
		}
	}
	return dataDir, cacheDir
}

func appInfo() AppInfo {
	dataDir, cacheDir := appPaths()
	return AppInfo{
		Version:            Version,
		Platform:           runtime.GOOS,
		DataDir:            dataDir,
		CacheDir:           cacheDir,
		AutostartSupported: true,
	}
}
