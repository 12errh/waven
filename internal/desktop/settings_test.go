package desktop

import (
	"errors"
	"path/filepath"
	"testing"

	"waven/internal/store"
)

func newSettingsStore(t *testing.T) *store.Store {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "waven.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func newSettingsTestService(t *testing.T) (*SettingsService, *store.Store) {
	t.Helper()
	st := newSettingsStore(t)
	return &SettingsService{
		store: st,
		applyAutostart: func(bool, bool) error {
			return nil
		},
	}, st
}

func TestSettingsDefaults(t *testing.T) {
	settings, _ := newSettingsTestService(t)

	got, err := settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WindowMode != platformDefaultWindowMode() {
		t.Fatalf("WindowMode = %q, want %q", got.WindowMode, platformDefaultWindowMode())
	}
	if !got.CloseToTray {
		t.Fatal("CloseToTray should default to true")
	}
	if got.StartHidden || got.Autostart {
		t.Fatalf("unexpected startup defaults: %+v", got)
	}
	if !got.AlwaysOnTopMini {
		t.Fatal("AlwaysOnTopMini should default to true")
	}
	if got.Layout != defaultLayoutSettings() {
		t.Fatalf("Layout = %+v, want %+v", got.Layout, defaultLayoutSettings())
	}
}

func TestSettingsRoundTrip(t *testing.T) {
	settings, _ := newSettingsTestService(t)

	next := AppSettings{
		WindowMode:      WindowModeSolid,
		CloseToTray:     false,
		StartHidden:     true,
		Autostart:       true,
		AlwaysOnTopMini: false,
		Layout: LayoutSettings{
			DockPosition: "bottom",
			DockExpanded: true,
			NavPosition:  "bottom",
			HeroPosition: "left",
			Split:        44,
		},
	}
	saved, err := settings.Update(next)
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if saved != next {
		t.Fatalf("Update returned %+v, want %+v", saved, next)
	}

	got, err := settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != next {
		t.Fatalf("Get = %+v, want %+v", got, next)
	}
}

func TestSettingsUpdateAppliesAutostart(t *testing.T) {
	st := newSettingsStore(t)
	var calls [][2]bool
	service := &SettingsService{
		store: st,
		applyAutostart: func(enabled, startHidden bool) error {
			calls = append(calls, [2]bool{enabled, startHidden})
			return nil
		},
	}

	if _, err := service.Update(AppSettings{
		WindowMode:  WindowModeGlass,
		Autostart:   true,
		StartHidden: true,
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if len(calls) != 1 || calls[0] != [2]bool{true, true} {
		t.Fatalf("autostart calls = %v, want [[true true]]", calls)
	}
}

func TestSettingsUpdateSkipsAutostartWhenStartupUnchanged(t *testing.T) {
	st := newSettingsStore(t)
	calls := 0
	service := &SettingsService{
		store: st,
		applyAutostart: func(bool, bool) error {
			calls++
			return nil
		},
	}

	if _, err := service.Update(AppSettings{
		WindowMode:  WindowModeSolid,
		CloseToTray: false,
	}); err != nil {
		t.Fatalf("Update appearance: %v", err)
	}
	if calls != 0 {
		t.Fatalf("appearance update touched autostart %d times", calls)
	}

	if _, err := service.Update(AppSettings{
		WindowMode:  WindowModeSolid,
		CloseToTray: false,
		StartHidden: true,
	}); err != nil {
		t.Fatalf("Update start hidden: %v", err)
	}
	if calls != 1 {
		t.Fatalf("startup update touched autostart %d times, want 1", calls)
	}
}

func TestSettingsUpdateRollsBackWhenAutostartFails(t *testing.T) {
	st := newSettingsStore(t)
	var calls [][2]bool
	service := &SettingsService{
		store: st,
		applyAutostart: func(enabled, startHidden bool) error {
			calls = append(calls, [2]bool{enabled, startHidden})
			if enabled {
				return errors.New("login item rejected")
			}
			return nil
		},
	}

	before, err := service.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if _, err := service.Update(AppSettings{
		WindowMode:      WindowModeSolid,
		CloseToTray:     false,
		Autostart:       true,
		AlwaysOnTopMini: false,
	}); err == nil {
		t.Fatal("Update should fail when the login item cannot be written")
	}

	after, err := service.Get()
	if err != nil {
		t.Fatalf("Get after rollback: %v", err)
	}
	if after != before {
		t.Fatalf("settings after rollback = %+v, want %+v", after, before)
	}
	if len(calls) != 2 || calls[0] != [2]bool{true, false} || calls[1] != [2]bool{false, false} {
		t.Fatalf("autostart calls = %v, want apply then rollback", calls)
	}
}

func TestSettingsPersistAcrossReopen(t *testing.T) {
	path := filepath.Join(t.TempDir(), "waven.db")
	first, err := store.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	service := &SettingsService{
		store: first,
		applyAutostart: func(bool, bool) error {
			return nil
		},
	}
	want := AppSettings{
		WindowMode:      WindowModePure,
		CloseToTray:     false,
		StartHidden:     true,
		Autostart:       true,
		AlwaysOnTopMini: false,
		Layout: LayoutSettings{
			DockPosition: "right",
			DockExpanded: false,
			NavPosition:  "hidden",
			HeroPosition: "bottom",
			Split:        70,
		},
	}
	if _, err := service.Update(want); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	reopened, err := store.Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	got, err := (&SettingsService{store: reopened}).Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != want {
		t.Fatalf("reopened settings = %+v, want %+v", got, want)
	}
}

func TestSettingsNormalisesUnknownWindowMode(t *testing.T) {
	settings, st := newSettingsTestService(t)
	if err := st.SetSetting(settingWindowMode, "neon"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	got, err := settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.WindowMode != platformDefaultWindowMode() {
		t.Fatalf("WindowMode = %q, want %q", got.WindowMode, platformDefaultWindowMode())
	}

	saved, err := settings.Update(AppSettings{WindowMode: "neon", CloseToTray: true})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if saved.WindowMode != platformDefaultWindowMode() {
		t.Fatalf("Update saved invalid mode %q", saved.WindowMode)
	}
}

func TestSettingsIgnoresInvalidBooleans(t *testing.T) {
	settings, st := newSettingsTestService(t)
	if err := st.SetSetting(settingCloseToTray, "not-a-bool"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}

	got, err := settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.CloseToTray {
		t.Fatal("invalid boolean should fall back to the default")
	}
}

func TestWindowBoundsRoundTrip(t *testing.T) {
	settings, _ := newSettingsTestService(t)

	want := WindowBounds{X: -1200, Y: 40, Width: 1280, Height: 820, Maximized: true}
	if err := settings.saveWindowBounds(want); err != nil {
		t.Fatalf("saveWindowBounds: %v", err)
	}
	got, ok := settings.windowBounds()
	if !ok {
		t.Fatal("windowBounds reported no saved bounds")
	}
	if got != want {
		t.Fatalf("windowBounds = %+v, want %+v", got, want)
	}
}

func TestWindowBoundsRejectsInvalidRows(t *testing.T) {
	settings, st := newSettingsTestService(t)

	if err := st.SetSetting(settingWindowBounds, "not json"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if _, ok := settings.windowBounds(); ok {
		t.Fatal("invalid JSON should be ignored")
	}

	if err := st.SetSetting(settingWindowBounds, `{"width":0,"height":0}`); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if _, ok := settings.windowBounds(); ok {
		t.Fatal("zero-sized bounds should be ignored")
	}

	if err := settings.saveWindowBounds(WindowBounds{Width: 0, Height: 100}); err == nil {
		t.Fatal("saveWindowBounds should reject a zero width")
	}
}

func TestSettingsNormalisesLayout(t *testing.T) {
	settings, st := newSettingsTestService(t)

	if err := st.SetSetting(settingUILayout, `{"dockPosition":"diagonal","navPosition":"sideways","heroPosition":"top","split":99}`); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	got, err := settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Layout != defaultLayoutSettings() {
		t.Fatalf("Layout = %+v, want defaults", got.Layout)
	}

	if err := st.SetSetting(settingUILayout, "not json"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	got, err = settings.Get()
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Layout != defaultLayoutSettings() {
		t.Fatalf("Layout after bad JSON = %+v, want defaults", got.Layout)
	}
}

func TestSettingsClampsSplitWhenWriting(t *testing.T) {
	settings, _ := newSettingsTestService(t)

	saved, err := settings.Update(AppSettings{
		WindowMode: WindowModeGlass,
		Layout: LayoutSettings{
			DockPosition: "left",
			NavPosition:  "top",
			HeroPosition: "right",
			Split:        10,
		},
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}
	if saved.Layout.Split != 58 {
		t.Fatalf("Split = %d, want the default 58", saved.Layout.Split)
	}
}

func TestMiniBoundsRoundTrip(t *testing.T) {
	settings, st := newSettingsTestService(t)

	if _, ok := settings.miniBounds(); ok {
		t.Fatal("fresh settings should not report mini bounds")
	}

	want := WindowBounds{X: 120, Y: 240, Width: 380, Height: 128}
	if err := settings.saveMiniBounds(want); err != nil {
		t.Fatalf("saveMiniBounds: %v", err)
	}
	got, ok := settings.miniBounds()
	if !ok {
		t.Fatal("expected saved mini bounds")
	}
	if got != want {
		t.Fatalf("mini bounds = %+v, want %+v", got, want)
	}

	// The mini placement is a separate row, so saving it never disturbs the
	// full-window placement that expanding restores.
	if _, ok := settings.windowBounds(); ok {
		t.Fatal("mini bounds must not write window.bounds")
	}
	if err := settings.saveWindowBounds(WindowBounds{X: 10, Y: 20, Width: 1280, Height: 820}); err != nil {
		t.Fatalf("saveWindowBounds: %v", err)
	}
	if got, _ := settings.miniBounds(); got != want {
		t.Fatalf("window bounds overwrote mini bounds: %+v", got)
	}

	if err := settings.saveMiniBounds(WindowBounds{Width: 0, Height: 128}); err == nil {
		t.Fatal("saveMiniBounds should reject a zero width")
	}

	if err := st.SetSetting(settingMiniBounds, "not json"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	if _, ok := settings.miniBounds(); ok {
		t.Fatal("invalid JSON should be ignored")
	}
}

func TestSettingsApplyHookReceivesWrites(t *testing.T) {
	settings, _ := newSettingsTestService(t)

	var applied []AppSettings
	settings.SetApplyHook(func(next AppSettings) {
		applied = append(applied, next)
	})

	if _, err := settings.Update(AppSettings{
		WindowMode:      WindowModeGlass,
		CloseToTray:     true,
		AlwaysOnTopMini: false,
	}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if len(applied) != 1 {
		t.Fatalf("hook called %d times, want 1", len(applied))
	}
	if applied[0].AlwaysOnTopMini {
		t.Fatal("hook should receive the saved always-on-top choice")
	}
}

func TestSettingsApplyHookSeesRollback(t *testing.T) {
	settings, _ := newSettingsTestService(t)
	settings.applyAutostart = func(bool, bool) error {
		return errors.New("login item unavailable")
	}

	var applied []AppSettings
	settings.SetApplyHook(func(next AppSettings) {
		applied = append(applied, next)
	})

	if _, err := settings.Update(AppSettings{
		WindowMode:  WindowModeGlass,
		Autostart:   true,
		StartHidden: true,
	}); err == nil {
		t.Fatal("Update should fail when the login item cannot be written")
	}
	if len(applied) != 1 {
		t.Fatalf("hook called %d times, want 1 rollback notification", len(applied))
	}
	if applied[0].Autostart || applied[0].StartHidden {
		t.Fatalf("hook should receive the previous settings, got %+v", applied[0])
	}
}
