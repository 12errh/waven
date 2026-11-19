package store

import (
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// playlistImportKey records that the one-time import from the old frontend
// localStorage playlists has run. The marker lives in the settings table so the
// import and the marker commit together.
const playlistImportKey = "playlists.legacy_import"

// Playlist is a user-built ordered collection of tracks.
type Playlist struct {
	ID         int64
	Name       string
	CreatedAt  int64
	UpdatedAt  int64
	CoverArtID string
	TrackIDs   []int64
}

// PlaylistImport is one legacy playlist handed over by the frontend.
type PlaylistImport struct {
	Name      string
	TrackIDs  []int64
	CreatedAt int64
}

const playlistColumns = `p.id, p.name, p.created_at, p.updated_at,
	COALESCE((
		SELECT t.art_id
		FROM playlist_tracks pt
		JOIN tracks t ON t.id = pt.track_id
		WHERE pt.playlist_id = p.id AND t.missing = 0
			AND t.art_id IS NOT NULL AND t.art_id <> ''
		ORDER BY pt.position
		LIMIT 1
	), '')`

// ListPlaylists returns every playlist with its ordered track IDs. Missing
// tracks are omitted so the UI never shows an unplayable row.
func (s *Store) ListPlaylists() ([]Playlist, error) {
	rows, err := s.db.Query(`SELECT ` + playlistColumns + `
		FROM playlists p
		ORDER BY p.created_at DESC, p.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	playlists := make([]Playlist, 0)
	index := make(map[int64]int)
	for rows.Next() {
		var p Playlist
		if err := rows.Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.CoverArtID); err != nil {
			return nil, err
		}
		p.TrackIDs = []int64{}
		index[p.ID] = len(playlists)
		playlists = append(playlists, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(playlists) == 0 {
		return playlists, nil
	}

	trackRows, err := s.db.Query(`
		SELECT pt.playlist_id, pt.track_id
		FROM playlist_tracks pt
		JOIN tracks t ON t.id = pt.track_id
		WHERE t.missing = 0
		ORDER BY pt.playlist_id, pt.position, pt.track_id`)
	if err != nil {
		return nil, err
	}
	defer trackRows.Close()
	for trackRows.Next() {
		var playlistID, trackID int64
		if err := trackRows.Scan(&playlistID, &trackID); err != nil {
			return nil, err
		}
		if at, ok := index[playlistID]; ok {
			playlists[at].TrackIDs = append(playlists[at].TrackIDs, trackID)
		}
	}
	return playlists, trackRows.Err()
}

// GetPlaylist returns one playlist with its ordered, present track IDs.
func (s *Store) GetPlaylist(id int64) (Playlist, error) {
	var p Playlist
	err := s.db.QueryRow(`SELECT `+playlistColumns+` FROM playlists p WHERE p.id = ?`, id).
		Scan(&p.ID, &p.Name, &p.CreatedAt, &p.UpdatedAt, &p.CoverArtID)
	if errors.Is(err, sql.ErrNoRows) {
		return Playlist{}, ErrNotFound
	}
	if err != nil {
		return Playlist{}, err
	}
	p.TrackIDs = []int64{}
	rows, err := s.db.Query(`
		SELECT pt.track_id
		FROM playlist_tracks pt
		JOIN tracks t ON t.id = pt.track_id
		WHERE pt.playlist_id = ? AND t.missing = 0
		ORDER BY pt.position, pt.track_id`, id)
	if err != nil {
		return Playlist{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var trackID int64
		if err := rows.Scan(&trackID); err != nil {
			return Playlist{}, err
		}
		p.TrackIDs = append(p.TrackIDs, trackID)
	}
	return p, rows.Err()
}

// CreatePlaylist creates a playlist, preserving the order of trackIDs. Tracks
// that are not present in the library are skipped.
func (s *Store) CreatePlaylist(name string, trackIDs []int64, createdAt int64) (Playlist, error) {
	var id int64
	err := s.withWriteTx(func(tx *sql.Tx) error {
		var err error
		id, err = createPlaylistTx(tx, name, trackIDs, createdAt)
		return err
	})
	if err != nil {
		return Playlist{}, err
	}
	return s.GetPlaylist(id)
}

func createPlaylistTx(tx *sql.Tx, name string, trackIDs []int64, createdAt int64) (int64, error) {
	now := time.Now().UnixMilli()
	if createdAt <= 0 {
		createdAt = now
	}
	res, err := tx.Exec(
		`INSERT INTO playlists (name, created_at, updated_at) VALUES (?, ?, ?)`,
		name, createdAt, createdAt,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	if err != nil {
		return 0, err
	}

	position := 0
	seen := make(map[int64]bool, len(trackIDs))
	for _, trackID := range trackIDs {
		if trackID <= 0 || seen[trackID] {
			continue
		}
		seen[trackID] = true
		res, err := tx.Exec(`
			INSERT INTO playlist_tracks (playlist_id, track_id, position)
			SELECT ?, id, ? FROM tracks WHERE id = ? AND missing = 0`,
			id, position, trackID)
		if err != nil {
			return 0, err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			position++
		}
	}
	return id, nil
}

// RenamePlaylist updates a playlist name.
func (s *Store) RenamePlaylist(id int64, name string) error {
	res, err := s.db.Exec(
		`UPDATE playlists SET name = ?, updated_at = ? WHERE id = ?`,
		name, time.Now().UnixMilli(), id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeletePlaylist removes a playlist and its entries.
func (s *Store) DeletePlaylist(id int64) error {
	res, err := s.db.Exec(`DELETE FROM playlists WHERE id = ?`, id)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// AddPlaylistTrack appends a track if it is present and not already in the
// playlist. Adding an existing entry is a no-op.
func (s *Store) AddPlaylistTrack(playlistID, trackID int64) error {
	return s.withWriteTx(func(tx *sql.Tx) error {
		if err := requirePlaylistTx(tx, playlistID); err != nil {
			return err
		}
		var exists int
		err := tx.QueryRow(`SELECT 1 FROM tracks WHERE id = ? AND missing = 0`, trackID).Scan(&exists)
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		if err != nil {
			return err
		}

		var current sql.NullInt64
		if err := tx.QueryRow(
			`SELECT MAX(position) FROM playlist_tracks WHERE playlist_id = ?`,
			playlistID,
		).Scan(&current); err != nil {
			return err
		}
		res, err := tx.Exec(`
			INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position)
			VALUES (?, ?, ?)`, playlistID, trackID, int(current.Int64)+1)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n > 0 {
			return touchPlaylistTx(tx, playlistID)
		}
		return nil
	})
}

// RemovePlaylistTrack removes a track from a playlist. Removing a missing entry
// is a no-op.
func (s *Store) RemovePlaylistTrack(playlistID, trackID int64) error {
	return s.withWriteTx(func(tx *sql.Tx) error {
		if err := requirePlaylistTx(tx, playlistID); err != nil {
			return err
		}
		if _, err := tx.Exec(
			`DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?`,
			playlistID, trackID,
		); err != nil {
			return err
		}
		return touchPlaylistTx(tx, playlistID)
	})
}

// ReorderPlaylistTracks rewrites every position. trackIDs must describe exactly
// the present tracks in the playlist; a mismatch is rejected so a stale client
// cannot silently drop entries.
func (s *Store) ReorderPlaylistTracks(playlistID int64, trackIDs []int64) error {
	return s.withWriteTx(func(tx *sql.Tx) error {
		if err := requirePlaylistTx(tx, playlistID); err != nil {
			return err
		}
		current, err := playlistTrackIDsTx(tx, playlistID)
		if err != nil {
			return err
		}
		if len(current) != len(trackIDs) {
			return fmt.Errorf("playlist changed while reordering (expected %d tracks, got %d)", len(current), len(trackIDs))
		}
		present := make(map[int64]bool, len(current))
		for _, id := range current {
			present[id] = true
		}
		seen := make(map[int64]bool, len(trackIDs))
		for _, id := range trackIDs {
			if !present[id] || seen[id] {
				return errors.New("playlist reorder does not match the current tracks")
			}
			seen[id] = true
		}
		for position, trackID := range trackIDs {
			if _, err := tx.Exec(
				`UPDATE playlist_tracks SET position = ? WHERE playlist_id = ? AND track_id = ?`,
				position, playlistID, trackID,
			); err != nil {
				return err
			}
		}
		return touchPlaylistTx(tx, playlistID)
	})
}

// ImportLegacyPlaylists imports the frontend's old localStorage playlists once.
// The settings marker and the new rows commit in one transaction, so a crash
// can never duplicate them on the next launch.
func (s *Store) ImportLegacyPlaylists(imports []PlaylistImport) (int, error) {
	imported := 0
	err := s.withWriteTx(func(tx *sql.Tx) error {
		var marker string
		err := tx.QueryRow(`SELECT value FROM settings WHERE key = ?`, playlistImportKey).Scan(&marker)
		if err == nil {
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}

		for _, entry := range imports {
			if entry.Name == "" {
				continue
			}
			if _, err := createPlaylistTx(tx, entry.Name, entry.TrackIDs, entry.CreatedAt); err != nil {
				return err
			}
			imported++
		}
		_, err = tx.Exec(`
			INSERT INTO settings (key, value) VALUES (?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			playlistImportKey, fmt.Sprintf("%d", imported))
		return err
	})
	if err != nil {
		return 0, err
	}
	return imported, nil
}

func requirePlaylistTx(tx *sql.Tx, id int64) error {
	var exists int
	err := tx.QueryRow(`SELECT 1 FROM playlists WHERE id = ?`, id).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}

func touchPlaylistTx(tx *sql.Tx, id int64) error {
	_, err := tx.Exec(`UPDATE playlists SET updated_at = ? WHERE id = ?`, time.Now().UnixMilli(), id)
	return err
}

func playlistTrackIDsTx(tx *sql.Tx, playlistID int64) ([]int64, error) {
	rows, err := tx.Query(`
		SELECT pt.track_id
		FROM playlist_tracks pt
		JOIN tracks t ON t.id = pt.track_id
		WHERE pt.playlist_id = ? AND t.missing = 0
		ORDER BY pt.position, pt.track_id`, playlistID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := make([]int64, 0)
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
