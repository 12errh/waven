//go:build linux

package desktop

import (
	"fmt"
	"log"
	"os"

	"github.com/godbus/dbus/v5"
)

const statusNotifierWatcher = "org.kde.StatusNotifierWatcher"

// activateTray simulates a StatusNotifier host activating the tray icon. The
// smoke test uses it to verify the same path a panel click takes.
func activateTray() error {
	conn, err := dbus.SessionBus()
	if err != nil {
		return err
	}
	service := fmt.Sprintf("org.kde.StatusNotifierItem-%d-1", os.Getpid())
	obj := conn.Object(service, "/StatusNotifierItem")
	return obj.Call("org.kde.StatusNotifierItem.Activate", 0, int32(0), int32(0)).Err
}

// watchTrayHost reports whether a StatusNotifierItem host is present on the
// session bus and calls onChange whenever that changes. GNOME only provides a
// host when an AppIndicator/KStatusNotifierItem extension is installed, while
// KDE, XFCE and most tiling-WM panels provide one by default.
//
// onChange is called once with the current state before this function returns.
// The returned stop function ends the watch.
func watchTrayHost(onChange func(bool)) func() {
	conn, err := dbus.SessionBus()
	if err != nil {
		log.Printf("tray: cannot reach the session bus: %v", err)
		onChange(false)
		return func() {}
	}

	hasOwner := func() bool {
		var owned bool
		err := conn.Object("org.freedesktop.DBus", "/org/freedesktop/DBus").
			Call("org.freedesktop.DBus.NameHasOwner", 0, statusNotifierWatcher).
			Store(&owned)
		return err == nil && owned
	}

	available := hasOwner()
	onChange(available)

	match := []dbus.MatchOption{
		dbus.WithMatchObjectPath("/org/freedesktop/DBus"),
		dbus.WithMatchInterface("org.freedesktop.DBus"),
		dbus.WithMatchMember("NameOwnerChanged"),
		dbus.WithMatchArg(0, statusNotifierWatcher),
	}
	if err := conn.AddMatchSignal(match...); err != nil {
		log.Printf("tray: cannot watch for a StatusNotifier host: %v", err)
		return func() {}
	}

	signals := make(chan *dbus.Signal, 8)
	conn.Signal(signals)
	stop := make(chan struct{})

	go func() {
		for {
			select {
			case <-stop:
				return
			case signal := <-signals:
				if signal == nil || signal.Name != "org.freedesktop.DBus.NameOwnerChanged" || len(signal.Body) < 3 {
					continue
				}
				name, _ := signal.Body[0].(string)
				newOwner, _ := signal.Body[2].(string)
				if name != statusNotifierWatcher {
					continue
				}
				next := newOwner != ""
				if next == available {
					continue
				}
				available = next
				onChange(next)
			}
		}
	}()

	return func() {
		close(stop)
		conn.RemoveSignal(signals)
		_ = conn.RemoveMatchSignal(match...)
	}
}
