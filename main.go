package main

import (
	"log"
	"log/slog"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"

	"waven/internal/desktop"
)

func main() {
	startHidden := false
	for _, arg := range os.Args[1:] {
		if arg == "--hidden" || arg == "-hidden" {
			startHidden = true
		}
	}

	// The second-instance callback needs the shell, which is created after the
	// application. The callback runs on a later launch, so the pointer is set
	// by then.
	var shell *desktop.Desktop
	assetsHandler := application.AssetFileServerFS(assetsFS())
	if os.Getenv("WAVEN_SMOKE") == "1" {
		assetsHandler = desktop.SmokeProbe(assetsHandler)
	}
	options := application.Options{
		Name:        "WAVEN",
		Description: "A spatial music player for your local library.",
		Icon:        desktop.AppIcon(),
		Assets: application.AssetOptions{
			Handler: assetsHandler,
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
		Windows: application.WindowsOptions{
			DisableQuitOnLastWindowClosed: true,
		},
		Linux: application.LinuxOptions{
			DisableQuitOnLastWindowClosed: true,
			ProgramName:                   "waven",
			ApplicationID:                 "com.waven.player",
		},
		SingleInstance: &application.SingleInstanceOptions{
			UniqueID: "com.waven.player",
			OnSecondInstanceLaunch: func(application.SecondInstanceData) {
				if shell == nil {
					return
				}
				log.Printf("single instance: focusing the existing window")
				shell.Show()
			},
		},
	}
	if os.Getenv("WAVEN_DEBUG") == "1" {
		options.LogLevel = slog.LevelDebug
	}

	app := application.New(options)

	libraryService, err := desktop.NewLibraryService(app)
	if err != nil {
		log.Fatal(err)
	}
	app.RegisterService(application.NewService(libraryService))

	settingsService, err := desktop.NewSettingsService(libraryService)
	if err != nil {
		log.Fatal(err)
	}
	app.RegisterService(application.NewService(settingsService))

	shell = desktop.New(app, settingsService, libraryService, startHidden)
	// Live preference changes (always-on-top for the mini player) reach the
	// window through this hook.
	settingsService.SetApplyHook(shell.ApplySettings)
	playerService, err := desktop.NewPlayerService(app, libraryService, shell)
	if err != nil {
		log.Fatal(err)
	}
	app.RegisterService(application.NewService(playerService))
	app.RegisterService(application.NewService(desktop.NewWindowService(shell)))

	shell.Start()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
