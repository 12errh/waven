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
	settingCloseToTray     = "app.closeToTray"
	settingStartHidden     = "app.startHidden"
	settingAutostart       = "app.autostart"
	settingAlwaysOnTopMini = "app.alwaysOnTopMini"
)

// AppSettings is the user-editable desktop configuration. Window bounds are
// stored separately because the shell writes them automatically.
type AppSettings struct {
	WindowMode      string `json:"windowMode"`
	CloseToTray     bool   `json:"closeToTray"`
	StartHidden     bool   `json:"startHidden"`
	Autostart       bool   `json:"autostart"`
	AlwaysOnTopMini bool   `json:"alwaysOnTopMini"`
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
	if err := s.writeLocked(next); err != nil {
		return AppSettings{}, err
	}
	if next.Autostart == previous.Autostart && next.StartHidden == previous.StartHidden {
		return next, nil
	}
	if err := s.updateAutostart(next.Autostart, next.StartHidden); err != nil {
		if rollbackErr := s.writeLocked(previous); rollbackErr != nil {
			return previous, fmt.Errorf("update autostart: %w (rollback failed: %v)", err, rollbackErr)
		}
		_ = s.updateAutostart(previous.Autostart, previous.StartHidden)
		return previous, fmt.Errorf("update autostart: %w", err)
	}
	return next, nil
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
	return settings, nil
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
	rows := map[string]string{
		settingWindowMode:      settings.WindowMode,
		settingCloseToTray:     strconv.FormatBool(settings.CloseToTray),
		settingStartHidden:     strconv.FormatBool(settings.StartHidden),
		settingAutostart:       strconv.FormatBool(settings.Autostart),
		settingAlwaysOnTopMini: strconv.FormatBool(settings.AlwaysOnTopMini),
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
	}
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
	raw, ok, err := s.store.Setting(settingWindowBounds)
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

func (s *SettingsService) saveWindowBounds(bounds WindowBounds) error {
	if bounds.Width <= 0 || bounds.Height <= 0 {
		return errors.New("window bounds must have a positive size")
	}
	encoded, err := json.Marshal(bounds)
	if err != nil {
		return fmt.Errorf("encode window bounds: %w", err)
	}
	return s.store.SetSetting(settingWindowBounds, string(encoded))
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
