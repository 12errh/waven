// Package media serves local audio and cached artwork to the webview over a
// loopback HTTP server. The server uses a per-launch token so the webview can
// use normal <audio>/<img> URLs and Range requests without exposing the files
// to other local processes.
package media

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"net"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"waven/internal/library"
	"waven/internal/store"
)

// Server is the per-launch loopback media server.
type Server struct {
	store    *store.Store
	artwork  *library.ArtworkCache
	listener net.Listener
	http     *http.Server
	token    string
	baseURL  string
}

// New starts the server on an ephemeral loopback port.
func New(st *store.Store, artwork *library.ArtworkCache) (*Server, error) {
	if st == nil || artwork == nil {
		return nil, errors.New("media: store and artwork cache are required")
	}
	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		return nil, fmt.Errorf("media: generate token: %w", err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return nil, fmt.Errorf("media: listen: %w", err)
	}

	s := &Server{
		store:    st,
		artwork:  artwork,
		listener: listener,
		token:    hex.EncodeToString(tokenBytes),
		baseURL:  "http://" + listener.Addr().String(),
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/m/", s.handleAudio)
	mux.HandleFunc("/a/", s.handleArtwork)
	s.http = &http.Server{
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		_ = s.http.Serve(listener)
	}()
	return s, nil
}

// URL returns the loopback origin.
func (s *Server) URL() string {
	if s == nil {
		return ""
	}
	return s.baseURL
}

// TrackURL returns the stream URL for a track.
func (s *Server) TrackURL(id int64) string {
	if s == nil || id <= 0 {
		return ""
	}
	return fmt.Sprintf("%s/m/%s/%d", s.baseURL, s.token, id)
}

// ArtURL returns the immutable artwork URL for a cached cover.
func (s *Server) ArtURL(id string) string {
	if s == nil || id == "" {
		return ""
	}
	return fmt.Sprintf("%s/a/%s/%s", s.baseURL, s.token, id)
}

// Close shuts the server down cleanly.
func (s *Server) Close() error {
	if s == nil || s.http == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.http.Shutdown(ctx)
}

func (s *Server) handleAudio(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token, rest, ok := splitPath(r.URL.Path, "/m/")
	if !ok || !s.validToken(token) {
		http.NotFound(w, r)
		return
	}
	id, err := strconv.ParseInt(rest, 10, 64)
	if err != nil || id <= 0 {
		http.NotFound(w, r)
		return
	}
	path, missing, err := s.store.GetTrackPath(id)
	if err != nil || missing {
		http.NotFound(w, r)
		return
	}
	if !s.pathInsideRoot(path) {
		http.NotFound(w, r)
		return
	}

	f, err := http.Dir(filepath.Dir(path)).Open(filepath.Base(path))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "no-store")
	if mime := audioMIME(filepath.Ext(path)); mime != "" {
		w.Header().Set("Content-Type", mime)
	}
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}

func (s *Server) handleArtwork(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		w.Header().Set("Allow", "GET, HEAD")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token, id, ok := splitPath(r.URL.Path, "/a/")
	if !ok || !s.validToken(token) {
		http.NotFound(w, r)
		return
	}
	path, err := s.artwork.Path(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	f, err := http.Dir(filepath.Dir(path)).Open(filepath.Base(path))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}

	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	w.Header().Set("Content-Type", "image/jpeg")
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}

func (s *Server) validToken(token string) bool {
	if len(token) != len(s.token) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(token), []byte(s.token)) == 1
}

func splitPath(path, prefix string) (string, string, bool) {
	if !strings.HasPrefix(path, prefix) {
		return "", "", false
	}
	parts := strings.Split(strings.TrimPrefix(path, prefix), "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", "", false
	}
	return parts[0], parts[1], true
}

// pathInsideRoot resolves symlinks on both sides. Tracks whose resolved path
// leaves every registered root are refused even if the database was tampered
// with.
func (s *Server) pathInsideRoot(path string) bool {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false
	}
	folders, err := s.store.ListFolders()
	if err != nil {
		return false
	}
	for _, folder := range folders {
		root, err := filepath.EvalSymlinks(folder.Path)
		if err != nil {
			continue
		}
		rel, err := filepath.Rel(root, resolved)
		if err != nil {
			continue
		}
		if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
			return true
		}
	}
	return false
}

func audioMIME(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".flac":
		return "audio/flac"
	case ".wav":
		return "audio/wav"
	case ".aiff", ".aif":
		return "audio/aiff"
	case ".ogg", ".oga", ".opus":
		return "audio/ogg"
	default:
		return ""
	}
}
