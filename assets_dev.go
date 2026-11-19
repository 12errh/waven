//go:build !production

package main

import (
	"io/fs"
	"os"
)

// assetsFS serves the exported frontend from disk in development builds.
// When FRONTEND_DEVSERVER_URL is set, Wails proxies the Next.js dev server
// instead and these files are ignored.
func assetsFS() fs.FS {
	return os.DirFS("frontend/out")
}
