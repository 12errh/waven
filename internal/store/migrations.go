package store

import (
	"database/sql"
	"fmt"
)

// migrations are applied in order inside a transaction. Append only: changing
// an existing migration would leave installed databases inconsistent.
var migrations = []string{
	// 1: initial library schema.
	`
CREATE TABLE folders (
    id            INTEGER PRIMARY KEY,
    path          TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL,
    last_scan_at  INTEGER
);

CREATE TABLE tracks (
    id             INTEGER PRIMARY KEY,
    folder_id      INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    path           TEXT NOT NULL UNIQUE,
    title          TEXT NOT NULL,
    artist         TEXT NOT NULL DEFAULT '',
    album          TEXT NOT NULL DEFAULT '',
    album_artist   TEXT NOT NULL DEFAULT '',
    genre          TEXT NOT NULL DEFAULT '',
    year           INTEGER,
    track_no       INTEGER,
    disc_no        INTEGER,
    duration_ms    INTEGER NOT NULL DEFAULT 0,
    bitrate_kbps   INTEGER,
    sample_rate    INTEGER,
    channels       INTEGER,
    format         TEXT NOT NULL,
    size_bytes     INTEGER NOT NULL,
    mtime          INTEGER NOT NULL,
    art_id         TEXT,
    accent         TEXT,
    search_text    TEXT NOT NULL,
    liked          INTEGER NOT NULL DEFAULT 0,
    missing        INTEGER NOT NULL DEFAULT 0,
    added_at       INTEGER NOT NULL,
    last_seen_scan INTEGER NOT NULL
);

CREATE INDEX idx_tracks_album
    ON tracks(album_artist, album, disc_no, track_no);
CREATE INDEX idx_tracks_artist ON tracks(artist);
CREATE INDEX idx_tracks_added ON tracks(added_at DESC);
CREATE INDEX idx_tracks_search ON tracks(search_text);
CREATE INDEX idx_tracks_liked ON tracks(liked) WHERE liked = 1;
CREATE INDEX idx_tracks_missing ON tracks(missing) WHERE missing = 1;
CREATE INDEX idx_tracks_folder ON tracks(folder_id);

CREATE TABLE plays (
    id         INTEGER PRIMARY KEY,
    track_id   INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ms_played  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_plays_track ON plays(track_id, started_at DESC);

CREATE TABLE playlists (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE TABLE playlist_tracks (
    playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
    track_id    INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
    position    INTEGER NOT NULL,
    PRIMARY KEY (playlist_id, track_id)
);
CREATE INDEX idx_playlist_position ON playlist_tracks(playlist_id, position);

CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
`,
}

func migrate(db *sql.DB) error {
	var version int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("read schema version: %w", err)
	}
	if version > len(migrations) {
		return fmt.Errorf("database schema version %d is newer than this app", version)
	}

	for i := version; i < len(migrations); i++ {
		tx, err := db.Begin()
		if err != nil {
			return fmt.Errorf("begin migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(migrations[i]); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("apply migration %d: %w", i+1, err)
		}
		if _, err := tx.Exec(fmt.Sprintf(`PRAGMA user_version = %d`, i+1)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("set schema version %d: %w", i+1, err)
		}
		if err := tx.Commit(); err != nil {
			return fmt.Errorf("commit migration %d: %w", i+1, err)
		}
	}
	return nil
}
