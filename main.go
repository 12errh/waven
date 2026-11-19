package main

import (
	"log"
	"log/slog"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"

	"waven/internal/desktop"
)

func main() {
	options := application.Options{
		Name:        "WAVEN",
		Description: "A spatial music player for your local library.",
		Icon:        desktop.AppIcon(),
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assetsFS()),
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
			ApplicationID:                 "app.waven.desktop",
		},
	}
	if os.Getenv("WAVEN_DEBUG") == "1" {
		options.LogLevel = slog.LevelDebug
	}

	app := application.New(options)

	shell := desktop.New(app)
	shell.Start()

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
