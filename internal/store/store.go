// Package store owns the SQLite library database. It is intentionally free of
// desktop and scanner concerns so it can be tested against a temporary file.
package store

import (
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sync"

	_ "modernc.org/sqlite"
)

// Store is the library database. A single Store is shared by the scanner and
// the Wails service.
type Store struct {
	db   *sql.DB
	path string

	// writeMu serialises write transactions. SQLite allows only one writer and
	// the scanner plus a like toggle can overlap.
	writeMu sync.Mutex
}

// Folder is a registered music root.
type Folder struct {
	ID         int64  `json:"id"`
	Path       string `json:"path"`
	CreatedAt  int64  `json:"createdAt"`
	LastScanAt *int64 `json:"lastScanAt"`
}

// FileState is the part of a track row that the incremental scanner needs.
type FileState struct {
	SizeBytes int64
	MTime     int64
	Missing   bool
}

// TrackRecord is a fully parsed file ready to be written.
type TrackRecord struct {
	FolderID     int64
	Path         string
	Title        string
	Artist       string
	Album        string
	AlbumArtist  string
	Genre        string
	Year         *int
	TrackNo      *int
	DiscNo       *int
	DurationMs   int64
	BitrateKbps  *int
	SampleRate   *int
	Channels     *int
	Format       string
	SizeBytes    int64
	MTime        int64
	ArtID        *string
	Accent       *string
	SearchText   string
	LastSeenScan int64
}

// Track is a row returned by library queries.
type Track struct {
	ID          int64  `json:"id"`
	FolderID    int64  `json:"folderId"`
	Path        string `json:"path"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	Genre       string `json:"genre"`
	Year        int    `json:"year"`
	TrackNo     int    `json:"trackNo"`
	DiscNo      int    `json:"discNo"`
	DurationMs  int64  `json:"durationMs"`
	BitrateKbps int    `json:"bitrateKbps"`
	SampleRate  int    `json:"sampleRate"`
	Channels    int    `json:"channels"`
	Format      string `json:"format"`
	SizeBytes   int64  `json:"sizeBytes"`
	MTime       int64  `json:"mtime"`
	ArtID       string `json:"artId"`
	Accent      string `json:"accent"`
	Liked       bool   `json:"liked"`
	Missing     bool   `json:"missing"`
	AddedAt     int64  `json:"addedAt"`
	LastSeen    int64  `json:"lastSeenScan"`
}

// TrackFilter controls a library page query.
type TrackFilter struct {
	Text           string
	Artist         string
	Album          string
	AlbumArtist    string
	Genre          string
	LikedOnly      bool
	IncludeMissing bool
	FolderID       int64
	Sort           string
	Limit          int
	Offset         int
}

// TrackPage is one page of tracks plus the total matching row count.
type TrackPage struct {
	Tracks []Track `json:"tracks"`
	Total  int     `json:"total"`
}

// AlbumSummary is a grouped album row.
type AlbumSummary struct {
	Album       string `json:"album"`
	AlbumArtist string `json:"albumArtist"`
	Year        int    `json:"year"`
	TrackCount  int    `json:"trackCount"`
	DurationMs  int64  `json:"durationMs"`
	ArtID       string `json:"artId"`
	Accent      string `json:"accent"`
}

// ArtistSummary is a grouped artist row.
type ArtistSummary struct {
	Artist     string `json:"artist"`
	TrackCount int    `json:"trackCount"`
	AlbumCount int    `json:"albumCount"`
	ArtID      string `json:"artId"`
	Accent     string `json:"accent"`
}

// GenreSummary is a grouped genre row.
type GenreSummary struct {
	Genre      string `json:"genre"`
	TrackCount int    `json:"trackCount"`
}

// AlbumPage is one page of album summaries.
type AlbumPage struct {
	Albums []AlbumSummary `json:"albums"`
	Total  int            `json:"total"`
}

// ArtistPage is one page of artist summaries.
type ArtistPage struct {
	Artists []ArtistSummary `json:"artists"`
	Total   int             `json:"total"`
}

// Stats is the library summary used by the profile screen.
type Stats struct {
	Tracks     int   `json:"tracks"`
	Albums     int   `json:"albums"`
	Artists    int   `json:"artists"`
	Genres     int   `json:"genres"`
	Folders    int   `json:"folders"`
	Liked      int   `json:"liked"`
	Missing    int   `json:"missing"`
	DurationMs int64 `json:"durationMs"`
	LastScanAt int64 `json:"lastScanAt"`
}

// Open opens (and creates) the SQLite database at path.
func Open(path string) (*Store, error) {
	if path == "" {
		return nil, errors.New("store: empty database path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, fmt.Errorf("create database directory: %w", err)
	}

	dsn := (&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String() +
		"?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=synchronous(NORMAL)"

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open library database: %w", err)
	}
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)

	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("connect to library database: %w", err)
	}
	if err := migrate(db); err != nil {
		db.Close()
		return nil, err
	}

	return &Store{db: db, path: path}, nil
}

// Close flushes and closes the database.
func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

// Path returns the database file path.
func (s *Store) Path() string {
	if s == nil {
		return ""
	}
	return s.path
}

// DB exposes the underlying handle for tests and maintenance only.
func (s *Store) DB() *sql.DB {
	return s.db
}

func (s *Store) withWriteTx(fn func(*sql.Tx) error) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
