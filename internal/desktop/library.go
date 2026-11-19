package desktop

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/wailsapp/wails/v3/pkg/application"

	"waven/internal/library"
	"waven/internal/media"
	"waven/internal/store"
)

// LibraryService is the Wails-facing library API. It owns the store, scanner,
// artwork cache, and loopback media server for the lifetime of the app.
type LibraryService struct {
	app     *application.App
	store   *store.Store
	artwork *library.ArtworkCache
	media   *media.Server
	scanner *library.Scanner

	scanMu       sync.Mutex
	scanRunning  bool
	scanCancel   context.CancelFunc
	progress     library.Progress
	lastSummary  *library.ScanSummary
	lastProgress time.Time
	lastPhase    string
}

// TrackQuery controls a library page request from the frontend.
type TrackQuery struct {
	Text        string `json:"text"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	Genre       string `json:"genre"`
	LikedOnly   bool   `json:"likedOnly"`
	Sort        string `json:"sort"`
	Limit       int    `json:"limit"`
	Offset      int    `json:"offset"`
}

// Track is the frontend-facing track model. It includes media-server URLs and
// the fields the existing WAVEN UI renders.
type Track struct {
	ID          int64   `json:"id"`
	Title       string  `json:"title"`
	Artist      string  `json:"artist"`
	Album       string  `json:"album"`
	AlbumArtist string  `json:"albumArtist"`
	Genre       string  `json:"genre"`
	Year        int     `json:"year"`
	TrackNo     int     `json:"trackNo"`
	DiscNo      int     `json:"discNo"`
	DurationMs  int64   `json:"durationMs"`
	DurationSec float64 `json:"durationSec"`
	BitrateKbps int     `json:"bitrateKbps"`
	SampleRate  int     `json:"sampleRate"`
	Channels    int     `json:"channels"`
	Format      string  `json:"format"`
	SizeBytes   int64   `json:"sizeBytes"`
	ArtID       string  `json:"artId"`
	CoverSrc    string  `json:"coverSrc"`
	AccentHex   string  `json:"accentHex"`
	AudioUrl    string  `json:"audioUrl"`
	Liked       bool    `json:"liked"`
	Missing     bool    `json:"missing"`
	AddedAt     int64   `json:"addedAt"`
}

// TrackPage is one page of tracks.
type TrackPage struct {
	Tracks []Track `json:"tracks"`
	Total  int     `json:"total"`
}

// Album is a grouped album for the Albums tab.
type Album struct {
	ID          string `json:"id"`
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	Year        int    `json:"year"`
	TrackCount  int    `json:"trackCount"`
	DurationSec int64  `json:"durationSec"`
	ArtID       string `json:"artId"`
	CoverSrc    string `json:"coverSrc"`
	AccentHex   string `json:"accentHex"`
}

// AlbumPage is one page of albums.
type AlbumPage struct {
	Albums []Album `json:"albums"`
	Total  int     `json:"total"`
}

// Artist is a grouped artist for the Artists tab.
type Artist struct {
	Name       string `json:"name"`
	TrackCount int    `json:"trackCount"`
	AlbumCount int    `json:"albumCount"`
	ArtID      string `json:"artId"`
	CoverSrc   string `json:"coverSrc"`
	AccentHex  string `json:"accentHex"`
}

// ArtistPage is one page of artists.
type ArtistPage struct {
	Artists []Artist `json:"artists"`
	Total   int      `json:"total"`
}

// Genre is a grouped genre for the Genres tab.
type Genre struct {
	Name       string `json:"name"`
	TrackCount int    `json:"trackCount"`
}

// SearchResults groups local search hits.
type SearchResults struct {
	Tracks  []Track  `json:"tracks"`
	Albums  []Album  `json:"albums"`
	Artists []Artist `json:"artists"`
}

// LibraryStats is the profile screen summary.
type LibraryStats struct {
	Tracks     int   `json:"tracks"`
	Albums     int   `json:"albums"`
	Artists    int   `json:"artists"`
	Genres     int   `json:"genres"`
	Folders    int   `json:"folders"`
	Liked      int   `json:"liked"`
	Missing    int   `json:"missing"`
	DurationMs int64 `json:"durationMs"`
	LastScanAt int64 `json:"lastScanAt"`
	CacheBytes int64 `json:"cacheBytes"`
}

// ScanStatus lets a reloaded frontend re-attach to a running scan.
type ScanStatus struct {
	Running  bool                 `json:"running"`
	Progress library.Progress     `json:"progress"`
	Last     *library.ScanSummary `json:"last,omitempty"`
}

// Playlist is the frontend-facing ordered collection.
type Playlist struct {
	ID        int64   `json:"id"`
	Name      string  `json:"name"`
	TrackIDs  []int64 `json:"trackIds"`
	CoverSrc  string  `json:"coverSrc"`
	CreatedAt int64   `json:"createdAt"`
	UpdatedAt int64   `json:"updatedAt"`
}

// PlaylistImport is one legacy localStorage playlist offered by the frontend.
type PlaylistImport struct {
	Name      string  `json:"name"`
	TrackIDs  []int64 `json:"trackIds"`
	CreatedAt int64   `json:"createdAt"`
}

// FolderImportResult reports what happened to files and folders dropped onto
// the window. Warnings let the UI surface per-path problems without failing the
// whole drop.
type FolderImportResult struct {
	Folders  []store.Folder `json:"folders"`
	Added    []string       `json:"added"`
	Existing []string       `json:"existing"`
	Warnings []string       `json:"warnings"`
}

// NewLibraryService opens the database, artwork cache, and media server using
// the platform config/cache directories (or WAVEN_DATA_DIR/WAVEN_CACHE_DIR).
func NewLibraryService(app *application.App) (*LibraryService, error) {
	dbPath, artPath, err := libraryPaths()
	if err != nil {
		return nil, err
	}
	st, err := store.Open(dbPath)
	if err != nil {
		return nil, err
	}
	art, err := library.NewArtworkCache(artPath)
	if err != nil {
		st.Close()
		return nil, err
	}
	server, err := media.New(st, art)
	if err != nil {
		st.Close()
		return nil, err
	}
	service := &LibraryService{
		app:     app,
		store:   st,
		artwork: art,
		media:   server,
	}
	service.scanner = &library.Scanner{
		Store:    st,
		Artwork:  art,
		Progress: service.emitProgress,
	}
	return service, nil
}

// ServiceName makes generated bindings call this service "Library".
func (s *LibraryService) ServiceName() string { return "Library" }

// ServiceShutdown releases the media server and database.
func (s *LibraryService) ServiceShutdown() error {
	s.scanMu.Lock()
	if s.scanCancel != nil {
		s.scanCancel()
	}
	s.scanMu.Unlock()
	if s.media != nil {
		_ = s.media.Close()
	}
	if s.store != nil {
		return s.store.Close()
	}
	return nil
}

func libraryPaths() (string, string, error) {
	dataDir, cacheDir := appPaths()
	if dataDir == "" {
		return "", "", fmt.Errorf("resolve config directory")
	}
	if cacheDir == "" {
		return "", "", fmt.Errorf("resolve cache directory")
	}
	return filepath.Join(dataDir, "waven.db"), filepath.Join(cacheDir, "artwork"), nil
}

// PickFolder opens the native folder picker. It returns an empty string when
// the user cancels.
func (s *LibraryService) PickFolder() (string, error) {
	if s.app == nil {
		return "", errors.New("desktop runtime is not attached")
	}
	path, err := s.app.Dialog.OpenFileWithOptions(&application.OpenFileDialogOptions{
		CanChooseDirectories: true,
		CanChooseFiles:       false,
		Title:                "Add a music folder",
		ButtonText:           "Add folder",
		Message:              "Choose a folder containing your music.",
	}).PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return path, nil
}

// AddFolder registers a root after rejecting overlapping roots.
func (s *LibraryService) AddFolder(path string) (store.Folder, error) {
	clean, err := library.NormalizePath(path)
	if err != nil {
		return store.Folder{}, err
	}
	resolved, err := filepath.EvalSymlinks(clean)
	if err == nil {
		clean = resolved
	}
	info, err := os.Stat(clean)
	if err != nil {
		return store.Folder{}, fmt.Errorf("folder is not accessible: %w", err)
	}
	if !info.IsDir() {
		return store.Folder{}, errors.New("selected path is not a folder")
	}

	folders, err := s.store.ListFolders()
	if err != nil {
		return store.Folder{}, err
	}
	for _, folder := range folders {
		if folder.Path == clean {
			return folder, nil
		}
		if pathsOverlap(folder.Path, clean) {
			return store.Folder{}, fmt.Errorf("this folder overlaps the existing root %q; remove that root first", folder.Path)
		}
	}
	return s.store.AddFolder(clean)
}

// GetFolders lists registered roots.
func (s *LibraryService) GetFolders() ([]store.Folder, error) {
	folders, err := s.store.ListFolders()
	if err != nil {
		return nil, err
	}
	if folders == nil {
		folders = []store.Folder{}
	}
	return folders, nil
}

// RemoveFolder removes a root and its tracks.
func (s *LibraryService) RemoveFolder(id int64) error {
	s.scanMu.Lock()
	running := s.scanRunning
	s.scanMu.Unlock()
	if running {
		return errors.New("wait for the current scan to finish or cancel it first")
	}
	return s.store.RemoveFolder(id)
}

// Rescan starts a scan in the background. folderID 0 scans every root.
func (s *LibraryService) Rescan(folderID int64) error {
	folders, err := s.store.ListFolders()
	if err != nil {
		return err
	}
	if folderID > 0 {
		folder, err := s.store.GetFolder(folderID)
		if err != nil {
			return err
		}
		folders = []store.Folder{folder}
	}
	if len(folders) == 0 {
		return errors.New("add a music folder before scanning")
	}

	s.scanMu.Lock()
	if s.scanRunning {
		s.scanMu.Unlock()
		return errors.New("a scan is already running")
	}
	ctx, cancel := context.WithCancel(context.Background())
	s.scanRunning = true
	s.scanCancel = cancel
	s.progress = library.Progress{Phase: "starting"}
	s.lastSummary = nil
	s.lastProgress = time.Time{}
	s.lastPhase = ""
	s.scanMu.Unlock()

	go s.runScan(ctx, folders)
	return nil
}

func (s *LibraryService) runScan(ctx context.Context, folders []store.Folder) {
	agg := library.ScanSummary{StartedAt: time.Now().UnixMilli(), Errors: make([]library.ScanIssue, 0)}
	for _, folder := range folders {
		if ctx.Err() != nil {
			agg.Canceled = true
			break
		}
		summary, err := s.scanner.Scan(ctx, folder)
		if err != nil {
			if ctx.Err() != nil {
				agg.Canceled = true
				break
			}
			agg.Errors = appendCapped(agg.Errors, library.ScanIssue{Path: folder.Path, Message: err.Error()})
			continue
		}
		agg.Added += summary.Added
		agg.Updated += summary.Updated
		agg.Removed += summary.Removed
		agg.Missing += summary.Missing
		agg.Skipped += summary.Skipped
		agg.Canceled = agg.Canceled || summary.Canceled
		for _, issue := range summary.Errors {
			agg.Errors = appendCapped(agg.Errors, issue)
		}
		if summary.Canceled {
			break
		}
	}
	agg.FinishedAt = time.Now().UnixMilli()

	s.scanMu.Lock()
	s.scanRunning = false
	s.scanCancel = nil
	s.lastSummary = &agg
	s.progress = library.Progress{Phase: "idle"}
	app := s.app
	s.scanMu.Unlock()

	if app != nil {
		app.Event.Emit("scan:done", agg)
	}
}

// CancelScan stops the running scan.
func (s *LibraryService) CancelScan() error {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	if !s.scanRunning || s.scanCancel == nil {
		return nil
	}
	s.scanCancel()
	return nil
}

// ScanStatus returns progress so a reloaded frontend can recover the banner.
func (s *LibraryService) ScanStatus() ScanStatus {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	status := ScanStatus{Running: s.scanRunning, Progress: s.progress}
	if s.lastSummary != nil {
		copySummary := *s.lastSummary
		status.Last = &copySummary
	}
	return status
}

func (s *LibraryService) emitProgress(p library.Progress) {
	s.scanMu.Lock()
	s.progress = p
	now := time.Now()
	shouldEmit := p.Phase != s.lastPhase || now.Sub(s.lastProgress) >= 100*time.Millisecond
	s.lastPhase = p.Phase
	if shouldEmit {
		s.lastProgress = now
	}
	app := s.app
	s.scanMu.Unlock()
	if shouldEmit && app != nil {
		app.Event.Emit("scan:progress", p)
	}
}

// GetTracks returns a filtered page from the library.
func (s *LibraryService) GetTracks(query TrackQuery) (TrackPage, error) {
	page, err := s.store.ListTracks(store.TrackFilter{
		Text:        library.Normalize(query.Text),
		Artist:      query.Artist,
		Album:       query.Album,
		AlbumArtist: query.AlbumArtist,
		Genre:       query.Genre,
		LikedOnly:   query.LikedOnly,
		Sort:        query.Sort,
		Limit:       query.Limit,
		Offset:      query.Offset,
	})
	if err != nil {
		return TrackPage{}, err
	}
	tracks := make([]Track, 0, len(page.Tracks))
	for _, row := range page.Tracks {
		tracks = append(tracks, s.toTrack(row))
	}
	return TrackPage{Tracks: tracks, Total: page.Total}, nil
}

// GetTrack returns one track for the now-playing card.
func (s *LibraryService) GetTrack(id int64) (Track, error) {
	row, err := s.store.GetTrack(id)
	if err != nil {
		return Track{}, err
	}
	return s.toTrack(row), nil
}

// GetLikedIDs hydrates heart state without loading every track.
func (s *LibraryService) GetLikedIDs() ([]int64, error) {
	ids, err := s.store.LikedIDs()
	if err != nil {
		return nil, err
	}
	if ids == nil {
		ids = []int64{}
	}
	return ids, nil
}

// GetAlbums returns grouped albums.
func (s *LibraryService) GetAlbums(limit, offset int) (AlbumPage, error) {
	page, err := s.store.Albums(limit, offset)
	if err != nil {
		return AlbumPage{}, err
	}
	albums := make([]Album, 0, len(page.Albums))
	for _, row := range page.Albums {
		albums = append(albums, Album{
			ID:          albumID(row.AlbumArtist, row.Album),
			Album:       row.Album,
			AlbumArtist: row.AlbumArtist,
			Year:        row.Year,
			TrackCount:  row.TrackCount,
			DurationSec: row.DurationMs / 1000,
			ArtID:       row.ArtID,
			CoverSrc:    s.media.ArtURL(row.ArtID),
			AccentHex:   row.Accent,
		})
	}
	return AlbumPage{Albums: albums, Total: page.Total}, nil
}

// GetArtists returns grouped artists.
func (s *LibraryService) GetArtists(limit, offset int) (ArtistPage, error) {
	page, err := s.store.Artists(limit, offset)
	if err != nil {
		return ArtistPage{}, err
	}
	artists := make([]Artist, 0, len(page.Artists))
	for _, row := range page.Artists {
		artists = append(artists, Artist{
			Name:       row.Artist,
			TrackCount: row.TrackCount,
			AlbumCount: row.AlbumCount,
			ArtID:      row.ArtID,
			CoverSrc:   s.media.ArtURL(row.ArtID),
			AccentHex:  row.Accent,
		})
	}
	return ArtistPage{Artists: artists, Total: page.Total}, nil
}

// GetGenres returns grouped genres.
func (s *LibraryService) GetGenres() ([]Genre, error) {
	rows, err := s.store.Genres()
	if err != nil {
		return nil, err
	}
	genres := make([]Genre, 0, len(rows))
	for _, row := range rows {
		genres = append(genres, Genre{Name: row.Genre, TrackCount: row.TrackCount})
	}
	return genres, nil
}

// Search finds songs and derives the matching albums and artists.
func (s *LibraryService) Search(query string, limit int) (SearchResults, error) {
	text := library.Normalize(query)
	if text == "" {
		return SearchResults{Tracks: []Track{}, Albums: []Album{}, Artists: []Artist{}}, nil
	}
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	page, err := s.store.ListTracks(store.TrackFilter{Text: text, Sort: "title", Limit: limit})
	if err != nil {
		return SearchResults{}, err
	}
	tracks := make([]Track, 0, len(page.Tracks))
	for _, row := range page.Tracks {
		tracks = append(tracks, s.toTrack(row))
	}
	rankText := text
	rank := func(i, j int) bool {
		return searchRank(tracks[i], rankText) < searchRank(tracks[j], rankText)
	}
	for i := 1; i < len(tracks); i++ {
		for j := i; j > 0 && rank(j, j-1); j-- {
			tracks[j], tracks[j-1] = tracks[j-1], tracks[j]
		}
	}

	albumSeen := map[string]bool{}
	albums := make([]Album, 0)
	albumRefs := make([]store.AlbumRef, 0)
	artistSeen := map[string]bool{}
	artists := make([]Artist, 0)
	artistNames := make([]string, 0)
	for _, t := range tracks {
		if t.Album != "" {
			key := albumID(t.AlbumArtist, t.Album)
			if !albumSeen[key] {
				albumSeen[key] = true
				albums = append(albums, Album{
					ID: key, Album: t.Album, AlbumArtist: t.AlbumArtist,
					Year: t.Year, ArtID: t.ArtID, CoverSrc: t.CoverSrc, AccentHex: t.AccentHex,
				})
				albumRefs = append(albumRefs, store.AlbumRef{Album: t.Album, AlbumArtist: t.AlbumArtist})
			}
		}
		if t.Artist != "" && !artistSeen[t.Artist] {
			artistSeen[t.Artist] = true
			artists = append(artists, Artist{Name: t.Artist, ArtID: t.ArtID, CoverSrc: t.CoverSrc, AccentHex: t.AccentHex})
			artistNames = append(artistNames, t.Artist)
		}
	}

	// A search hit only carries the matching page, so fill each grouped card
	// with the full-library totals the Albums and Artists tabs show.
	albumCounts, err := s.store.AlbumTrackCounts(albumRefs)
	if err != nil {
		return SearchResults{}, err
	}
	for i := range albums {
		albums[i].TrackCount = albumCounts[store.AlbumRef{Album: albums[i].Album, AlbumArtist: albums[i].AlbumArtist}]
	}
	artistCounts, err := s.store.ArtistTrackCounts(artistNames)
	if err != nil {
		return SearchResults{}, err
	}
	for i := range artists {
		summary := artistCounts[artists[i].Name]
		artists[i].TrackCount = summary.TrackCount
		artists[i].AlbumCount = summary.AlbumCount
		if artists[i].ArtID == "" {
			artists[i].ArtID = summary.ArtID
			artists[i].CoverSrc = s.media.ArtURL(summary.ArtID)
			artists[i].AccentHex = summary.Accent
		}
	}
	return SearchResults{Tracks: tracks, Albums: albums, Artists: artists}, nil
}

// GetMix returns one of the in-library mixes used by Discover. Kinds are
// "recently_added", "recently_played", "on_repeat", and "favorites".
func (s *LibraryService) GetMix(kind string, limit int) ([]Track, error) {
	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	var rows []store.Track
	switch kind {
	case "recently_added":
		page, err := s.store.ListTracks(store.TrackFilter{Sort: "added", Limit: limit})
		if err != nil {
			return nil, err
		}
		rows = page.Tracks
	case "recently_played":
		list, err := s.store.RecentlyPlayed(limit)
		if err != nil {
			return nil, err
		}
		rows = list
	case "on_repeat":
		list, err := s.store.OnRepeat(limit, 14, 3)
		if err != nil {
			return nil, err
		}
		rows = list
	case "favorites":
		page, err := s.store.ListTracks(store.TrackFilter{LikedOnly: true, Sort: "title", Limit: limit})
		if err != nil {
			return nil, err
		}
		rows = page.Tracks
	default:
		return nil, fmt.Errorf("unknown mix %q", kind)
	}
	tracks := make([]Track, 0, len(rows))
	for _, row := range rows {
		tracks = append(tracks, s.toTrack(row))
	}
	return tracks, nil
}

// GetStats returns library counters and artwork cache size.
func (s *LibraryService) GetStats() (LibraryStats, error) {
	st, err := s.store.Stats()
	if err != nil {
		return LibraryStats{}, err
	}
	return LibraryStats{
		Tracks:     st.Tracks,
		Albums:     st.Albums,
		Artists:    st.Artists,
		Genres:     st.Genres,
		Folders:    st.Folders,
		Liked:      st.Liked,
		Missing:    st.Missing,
		DurationMs: st.DurationMs,
		LastScanAt: st.LastScanAt,
		CacheBytes: s.artwork.Size(),
	}, nil
}

// GetPlaylists returns every playlist with its ordered track IDs.
func (s *LibraryService) GetPlaylists() ([]Playlist, error) {
	rows, err := s.store.ListPlaylists()
	if err != nil {
		return nil, err
	}
	playlists := make([]Playlist, 0, len(rows))
	for _, row := range rows {
		playlists = append(playlists, s.toPlaylist(row))
	}
	return playlists, nil
}

// CreatePlaylist creates a playlist and optionally seeds it with tracks.
func (s *LibraryService) CreatePlaylist(name string, trackIDs []int64) (Playlist, error) {
	clean, err := playlistName(name)
	if err != nil {
		return Playlist{}, err
	}
	row, err := s.store.CreatePlaylist(clean, trackIDs, 0)
	if err != nil {
		return Playlist{}, err
	}
	return s.toPlaylist(row), nil
}

// RenamePlaylist updates a playlist name.
func (s *LibraryService) RenamePlaylist(id int64, name string) error {
	clean, err := playlistName(name)
	if err != nil {
		return err
	}
	return s.store.RenamePlaylist(id, clean)
}

// DeletePlaylist removes a playlist. Tracks and files are untouched.
func (s *LibraryService) DeletePlaylist(id int64) error {
	return s.store.DeletePlaylist(id)
}

// AddTrackToPlaylist appends a track if it is not already in the playlist.
func (s *LibraryService) AddTrackToPlaylist(id, trackID int64) error {
	return s.store.AddPlaylistTrack(id, trackID)
}

// RemoveFromPlaylist removes a track from a playlist.
func (s *LibraryService) RemoveFromPlaylist(id, trackID int64) error {
	return s.store.RemovePlaylistTrack(id, trackID)
}

// ReorderPlaylist rewrites the track order. The frontend sends the complete
// list so stored positions always match what the user sees.
func (s *LibraryService) ReorderPlaylist(id int64, trackIDs []int64) error {
	return s.store.ReorderPlaylistTracks(id, trackIDs)
}

// ImportPlaylists performs the one-time import of the old localStorage
// playlists. The store keeps a marker so relaunching cannot duplicate them.
func (s *LibraryService) ImportPlaylists(imports []PlaylistImport) (int, error) {
	clean := make([]store.PlaylistImport, 0, len(imports))
	for _, entry := range imports {
		name, err := playlistName(entry.Name)
		if err != nil {
			continue
		}
		clean = append(clean, store.PlaylistImport{
			Name:      name,
			TrackIDs:  entry.TrackIDs,
			CreatedAt: entry.CreatedAt,
		})
	}
	return s.store.ImportLegacyPlaylists(clean)
}

// ImportDroppedPaths registers the folders behind a native file drop. Dropped
// files contribute their parent directory because the library is folder based.
// The frontend starts the scan after this returns so one drop means one scan.
func (s *LibraryService) ImportDroppedPaths(paths []string) (FolderImportResult, error) {
	result := FolderImportResult{
		Folders:  []store.Folder{},
		Added:    []string{},
		Existing: []string{},
		Warnings: []string{},
	}
	if len(paths) == 0 {
		return result, errors.New("no files or folders were dropped")
	}

	candidates := make([]string, 0, len(paths))
	seen := make(map[string]bool, len(paths))
	for _, raw := range paths {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		clean, err := library.NormalizePath(raw)
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", raw, err))
			continue
		}
		if resolved, err := filepath.EvalSymlinks(clean); err == nil {
			clean = resolved
		}
		info, err := os.Stat(clean)
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s is not accessible", clean))
			continue
		}
		if !info.IsDir() {
			clean = filepath.Dir(clean)
		}
		if seen[clean] {
			continue
		}
		seen[clean] = true
		candidates = append(candidates, clean)
	}
	if len(candidates) == 0 {
		return result, nil
	}

	// Keep only the outermost roots: dropping a folder and a file inside it
	// must register one root, not a nested pair.
	roots := make([]string, 0, len(candidates))
	for _, candidate := range candidates {
		covered := false
		for _, other := range candidates {
			if other != candidate && pathInside(other, candidate) {
				covered = true
				break
			}
		}
		if !covered {
			roots = append(roots, candidate)
		}
	}
	sort.Strings(roots)

	folders, err := s.store.ListFolders()
	if err != nil {
		return result, err
	}
	for _, root := range roots {
		exact := false
		covered := false
		conflict := ""
		for _, folder := range folders {
			switch {
			case folder.Path == root:
				exact = true
			case pathInside(folder.Path, root):
				covered = true
			case pathInside(root, folder.Path):
				conflict = folder.Path
			}
			if exact || covered || conflict != "" {
				break
			}
		}
		if exact || covered {
			result.Existing = append(result.Existing, root)
			continue
		}
		if conflict != "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf(
				"%s overlaps the existing library root %q; remove that root first", root, conflict))
			continue
		}
		folder, err := s.store.AddFolder(root)
		if err != nil {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s: %v", root, err))
			continue
		}
		folders = append(folders, folder)
		result.Folders = append(result.Folders, folder)
		result.Added = append(result.Added, root)
	}
	return result, nil
}

// SetLiked persists a heart toggle.
func (s *LibraryService) SetLiked(id int64, liked bool) error {
	return s.store.SetLiked(id, liked)
}

// SetDuration persists the duration reported by loadedmetadata.
func (s *LibraryService) SetDuration(id, durationMs int64) error {
	if durationMs < 0 {
		return errors.New("duration must be non-negative")
	}
	return s.store.SetDuration(id, durationMs)
}

func (s *LibraryService) toTrack(row store.Track) Track {
	return Track{
		ID:          row.ID,
		Title:       row.Title,
		Artist:      row.Artist,
		Album:       row.Album,
		AlbumArtist: row.AlbumArtist,
		Genre:       row.Genre,
		Year:        row.Year,
		TrackNo:     row.TrackNo,
		DiscNo:      row.DiscNo,
		DurationMs:  row.DurationMs,
		DurationSec: float64(row.DurationMs) / 1000,
		BitrateKbps: row.BitrateKbps,
		SampleRate:  row.SampleRate,
		Channels:    row.Channels,
		Format:      row.Format,
		SizeBytes:   row.SizeBytes,
		ArtID:       row.ArtID,
		CoverSrc:    s.media.ArtURL(row.ArtID),
		AccentHex:   row.Accent,
		AudioUrl:    s.media.TrackURL(row.ID),
		Liked:       row.Liked,
		Missing:     row.Missing,
		AddedAt:     row.AddedAt,
	}
}

func albumID(artist, album string) string {
	return artist + "::" + album
}

func searchRank(t Track, text string) int {
	title := library.Normalize(t.Title)
	artist := library.Normalize(t.Artist)
	switch {
	case strings.HasPrefix(title, text):
		return 0
	case strings.HasPrefix(artist, text):
		return 1
	case strings.Contains(title, text):
		return 2
	default:
		return 3
	}
}

func pathsOverlap(a, b string) bool {
	return pathInside(a, b) || pathInside(b, a)
}

// pathInside reports whether child is parent itself or lives below it.
func pathInside(parent, child string) bool {
	rel, err := filepath.Rel(parent, child)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)))
}

// playlistName trims and validates a user-supplied playlist name.
func playlistName(name string) (string, error) {
	clean := strings.TrimSpace(name)
	if clean == "" {
		return "", errors.New("playlist name cannot be empty")
	}
	if utf8.RuneCountInString(clean) > 80 {
		return "", errors.New("playlist name cannot be longer than 80 characters")
	}
	return clean, nil
}

func (s *LibraryService) toPlaylist(row store.Playlist) Playlist {
	trackIDs := row.TrackIDs
	if trackIDs == nil {
		trackIDs = []int64{}
	}
	return Playlist{
		ID:        row.ID,
		Name:      row.Name,
		TrackIDs:  trackIDs,
		CoverSrc:  s.media.ArtURL(row.CoverArtID),
		CreatedAt: row.CreatedAt,
		UpdatedAt: row.UpdatedAt,
	}
}

func appendCapped[T any](values []T, value T) []T {
	const maxItems = 50
	if len(values) >= maxItems {
		return values
	}
	return append(values, value)
}

func (s *LibraryService) logf(format string, args ...any) {
	if os.Getenv("WAVEN_DEBUG") == "1" {
		log.Printf(format, args...)
	}
}
