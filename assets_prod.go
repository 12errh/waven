//go:build production

package main

import (
	"embed"
	"io/fs"
	"log"
)

// The all: prefix is required so Next.js' `_next` directory is embedded too.
//
//go:embed all:frontend/out
var embeddedAssets embed.FS

func assetsFS() fs.FS {
	assets, err := fs.Sub(embeddedAssets, "frontend/out")
	if err != nil {
		log.Fatalf("prepare embedded frontend: %v", err)
	}
	return assets
}
