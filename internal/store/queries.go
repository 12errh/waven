package store

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// ErrNotFound is returned when a requested row does not exist.
var ErrNotFound = errors.New("not found")

// AddFolder registers a music root and returns it.
func (s *Store) AddFolder(path string) (Folder, error) {
	now := time.Now().UnixMilli()
	_, err := s.db.Exec(
		`INSERT INTO folders (path, created_at) VALUES (?, ?)
		 ON CONFLICT(path) DO UPDATE SET path = excluded.path`,
		path, now,
	)
	if err != nil {
		return Folder{}, err
	}
	// ON CONFLICT does not update LAST_INSERT_ID; look the row up so callers
	// always receive the canonical record.
	return s.folderByPath(path)
}

func (s *Store) folderByPath(path string) (Folder, error) {
	row := s.db.QueryRow(`SELECT id, path, created_at, last_scan_at FROM folders WHERE path = ?`, path)
	f, err := scanFolder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Folder{}, ErrNotFound
	}
	return f, err
}

// ListFolders returns every registered root ordered by path.
func (s *Store) ListFolders() ([]Folder, error) {
	rows, err := s.db.Query(`SELECT id, path, created_at, last_scan_at FROM folders ORDER BY path COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	folders := make([]Folder, 0)
	for rows.Next() {
		f, err := scanFolder(rows)
		if err != nil {
			return nil, err
		}
		folders = append(folders, f)
	}
	return folders, rows.Err()
}

// GetFolder returns one root by ID.
func (s *Store) GetFolder(id int64) (Folder, error) {
	row := s.db.QueryRow(`SELECT id, path, created_at, last_scan_at FROM folders WHERE id = ?`, id)
	f, err := scanFolder(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Folder{}, ErrNotFound
	}
	return f, err
}

// RemoveFolder deletes a root and all tracks that belong to it.
func (s *Store) RemoveFolder(id int64) error {
	_, err := s.db.Exec(`DELETE FROM folders WHERE id = ?`, id)
	return err
}

// SetFolderLastScan records a completed scan time.
func (s *Store) SetFolderLastScan(id, at int64) error {
	_, err := s.db.Exec(`UPDATE folders SET last_scan_at = ? WHERE id = ?`, at, id)
	return err
}

func scanFolder(row interface {
	Scan(dest ...any) error
}) (Folder, error) {
	var f Folder
	var last sql.NullInt64
	if err := row.Scan(&f.ID, &f.Path, &f.CreatedAt, &last); err != nil {
		return Folder{}, err
	}
	if last.Valid {
		v := last.Int64
		f.LastScanAt = &v
	}
	return f, nil
}

// FileStates returns the incremental fingerprint for every track in a root.
func (s *Store) FileStates(folderID int64) (map[string]FileState, error) {
	rows, err := s.db.Query(`SELECT path, size_bytes, mtime, missing FROM tracks WHERE folder_id = ?`, folderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	states := make(map[string]FileState)
	for rows.Next() {
		var path string
		var state FileState
		var missing int
		if err := rows.Scan(&path, &state.SizeBytes, &state.MTime, &missing); err != nil {
			return nil, err
		}
		state.Missing = missing != 0
		states[path] = state
	}
	return states, rows.Err()
}

// UpsertTracks writes a batch of parsed tracks. The file path is the stable
// identity, so a moved file keeps its like and added date when it is rescanned
// under a different root.
func (s *Store) UpsertTracks(records []TrackRecord) error {
	if len(records) == 0 {
		return nil
	}
	now := time.Now().UnixMilli()
	return s.withWriteTx(func(tx *sql.Tx) error {
		stmt, err := tx.Prepare(`
INSERT INTO tracks (
    folder_id, path, title, artist, album, album_artist, genre, year,
    track_no, disc_no, duration_ms, bitrate_kbps, sample_rate, channels,
    format, size_bytes, mtime, art_id, accent, search_text, liked, missing,
    added_at, last_seen_scan
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?)
ON CONFLICT(path) DO UPDATE SET
    folder_id = excluded.folder_id,
    title = excluded.title,
    artist = excluded.artist,
    album = excluded.album,
    album_artist = excluded.album_artist,
    genre = excluded.genre,
    year = excluded.year,
    track_no = excluded.track_no,
    disc_no = excluded.disc_no,
    duration_ms = excluded.duration_ms,
    bitrate_kbps = excluded.bitrate_kbps,
    sample_rate = excluded.sample_rate,
    channels = excluded.channels,
    format = excluded.format,
    size_bytes = excluded.size_bytes,
    mtime = excluded.mtime,
    art_id = excluded.art_id,
    accent = excluded.accent,
    search_text = excluded.search_text,
    missing = 0,
    last_seen_scan = excluded.last_seen_scan`)
		if err != nil {
			return err
		}
		defer stmt.Close()

		for _, r := range records {
			if _, err := stmt.Exec(
				r.FolderID, r.Path, r.Title, r.Artist, r.Album, r.AlbumArtist, r.Genre,
				nullableInt(r.Year), nullableInt(r.TrackNo), nullableInt(r.DiscNo),
				r.DurationMs, nullableInt(r.BitrateKbps), nullableInt(r.SampleRate),
				nullableInt(r.Channels), r.Format, r.SizeBytes, r.MTime,
				nullableString(r.ArtID), nullableString(r.Accent), r.SearchText,
				now, r.LastSeenScan,
			); err != nil {
				return fmt.Errorf("%s: %w", r.Path, err)
			}
		}
		return nil
	})
}

// TouchTracks marks unchanged files as seen by this scan without rewriting
// their metadata.
func (s *Store) TouchTracks(folderID, scanTime int64, paths []string) error {
	if len(paths) == 0 {
		return nil
	}
	return s.withWriteTx(func(tx *sql.Tx) error {
		stmt, err := tx.Prepare(`UPDATE tracks SET last_seen_scan = ?, missing = 0 WHERE folder_id = ? AND path = ?`)
		if err != nil {
			return err
		}
		defer stmt.Close()
		for _, path := range paths {
			if _, err := stmt.Exec(scanTime, folderID, path); err != nil {
				return err
			}
		}
		return nil
	})
}

// MarkMissing flags rows the completed scan did not see and returns how many
// tracks became missing.
func (s *Store) MarkMissing(folderID, scanTime int64) (int, error) {
	var count int
	err := s.withWriteTx(func(tx *sql.Tx) error {
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM tracks WHERE folder_id = ? AND missing = 0 AND last_seen_scan <> ?`,
			folderID, scanTime,
		).Scan(&count); err != nil {
			return err
		}
		_, err := tx.Exec(
			`UPDATE tracks SET missing = 1 WHERE folder_id = ? AND missing = 0 AND last_seen_scan <> ?`,
			folderID, scanTime,
		)
		return err
	})
	return count, err
}

// ListTracks returns a filtered page and the total matching count.
func (s *Store) ListTracks(f TrackFilter) (TrackPage, error) {
	where, args := trackWhere(f)
	order := trackOrder(f.Sort)

	limit := f.Limit
	if limit <= 0 {
		limit = 500
	}
	if limit > 10000 {
		limit = 10000
	}
	offset := f.Offset
	if offset < 0 {
		offset = 0
	}

	query := `SELECT ` + trackColumns + ` FROM tracks ` + where + ` ORDER BY ` + order + ` LIMIT ? OFFSET ?`
	pageArgs := append(append([]any{}, args...), limit, offset)
	rows, err := s.db.Query(query, pageArgs...)
	if err != nil {
		return TrackPage{}, err
	}
	defer rows.Close()

	tracks := make([]Track, 0, min(limit, 256))
	for rows.Next() {
		t, err := scanTrack(rows)
		if err != nil {
			return TrackPage{}, err
		}
		tracks = append(tracks, t)
	}
	if err := rows.Err(); err != nil {
		return TrackPage{}, err
	}

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM tracks `+where, args...).Scan(&total); err != nil {
		return TrackPage{}, err
	}
	return TrackPage{Tracks: tracks, Total: total}, nil
}

func trackWhere(f TrackFilter) (string, []any) {
	clauses := make([]string, 0, 8)
	args := make([]any, 0, 8)
	if !f.IncludeMissing {
		clauses = append(clauses, "missing = 0")
	}
	if f.FolderID > 0 {
		clauses = append(clauses, "folder_id = ?")
		args = append(args, f.FolderID)
	}
	if f.LikedOnly {
		clauses = append(clauses, "liked = 1")
	}
	if f.Artist != "" {
		clauses = append(clauses, "artist = ?")
		args = append(args, f.Artist)
	}
	if f.Album != "" {
		clauses = append(clauses, "album = ?")
		args = append(args, f.Album)
	}
	if f.AlbumArtist != "" {
		clauses = append(clauses, "album_artist = ?")
		args = append(args, f.AlbumArtist)
	}
	if f.Genre != "" {
		clauses = append(clauses, "genre = ?")
		args = append(args, f.Genre)
	}
	if f.Text != "" {
		like := "%" + escapeLike(f.Text) + "%"
		clauses = append(clauses, `search_text LIKE ? ESCAPE '\'`)
		args = append(args, like)
	}
	if len(clauses) == 0 {
		return "", args
	}
	return "WHERE " + strings.Join(clauses, " AND "), args
}

func trackOrder(sort string) string {
	switch sort {
	case "added":
		return "added_at DESC, title COLLATE NOCASE"
	case "title":
		return "title COLLATE NOCASE, artist COLLATE NOCASE"
	case "album":
		return "album COLLATE NOCASE, album_artist COLLATE NOCASE, disc_no, track_no"
	case "album_order":
		return "disc_no, track_no, title COLLATE NOCASE"
	case "duration":
		return "duration_ms DESC, title COLLATE NOCASE"
	case "artist", "":
		return "artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, title COLLATE NOCASE"
	default:
		return "artist COLLATE NOCASE, album COLLATE NOCASE, disc_no, track_no, title COLLATE NOCASE"
	}
}

const trackColumns = `id, folder_id, path, title, artist, album, album_artist, genre,
	year, track_no, disc_no, duration_ms, bitrate_kbps, sample_rate, channels,
	format, size_bytes, mtime, art_id, accent, liked, missing, added_at, last_seen_scan`

func scanTrack(row interface {
	Scan(dest ...any) error
}) (Track, error) {
	var t Track
	var year, trackNo, discNo, bitrate, sampleRate, channels sql.NullInt64
	var artID, accent sql.NullString
	var liked, missing int
	err := row.Scan(
		&t.ID, &t.FolderID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.AlbumArtist,
		&t.Genre, &year, &trackNo, &discNo, &t.DurationMs, &bitrate, &sampleRate,
		&channels, &t.Format, &t.SizeBytes, &t.MTime, &artID, &accent,
		&liked, &missing, &t.AddedAt, &t.LastSeen,
	)
	if err != nil {
		return Track{}, err
	}
	t.Year = int(year.Int64)
	t.TrackNo = int(trackNo.Int64)
	t.DiscNo = int(discNo.Int64)
	t.BitrateKbps = int(bitrate.Int64)
	t.SampleRate = int(sampleRate.Int64)
	t.Channels = int(channels.Int64)
	t.ArtID = artID.String
	t.Accent = accent.String
	t.Liked = liked != 0
	t.Missing = missing != 0
	return t, nil
}

// GetTrack returns a single track by ID.
func (s *Store) GetTrack(id int64) (Track, error) {
	row := s.db.QueryRow(`SELECT `+trackColumns+` FROM tracks WHERE id = ?`, id)
	t, err := scanTrack(row)
	if errors.Is(err, sql.ErrNoRows) {
		return Track{}, ErrNotFound
	}
	return t, err
}

// MissingCount returns the number of missing rows in a folder, or the whole
// library when folderID is zero.
func (s *Store) MissingCount(folderID int64) (int, error) {
	var count int
	var err error
	if folderID > 0 {
		err = s.db.QueryRow(`SELECT COUNT(*) FROM tracks WHERE missing = 1 AND folder_id = ?`, folderID).Scan(&count)
	} else {
		err = s.db.QueryRow(`SELECT COUNT(*) FROM tracks WHERE missing = 1`).Scan(&count)
	}
	return count, err
}

// GetTrackPath returns the file path for a track that is safe to stream.
func (s *Store) GetTrackPath(id int64) (string, bool, error) {
	var path string
	var missing int
	err := s.db.QueryRow(`SELECT path, missing FROM tracks WHERE id = ?`, id).Scan(&path, &missing)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, ErrNotFound
	}
	return path, missing != 0, err
}

// LikedIDs returns all liked, present track IDs. It is used to hydrate the
// heart state without loading every track.
func (s *Store) LikedIDs() ([]int64, error) {
	rows, err := s.db.Query(`SELECT id FROM tracks WHERE liked = 1 AND missing = 0`)
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

// SetLiked updates the heart state for a track.
func (s *Store) SetLiked(id int64, liked bool) error {
	v := 0
	if liked {
		v = 1
	}
	res, err := s.db.Exec(`UPDATE tracks SET liked = ? WHERE id = ?`, v, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// SetDuration persists the duration reported by the webview when the
// container header could not provide one.
func (s *Store) SetDuration(id, durationMs int64) error {
	if durationMs <= 0 {
		return nil
	}
	_, err := s.db.Exec(`UPDATE tracks SET duration_ms = ? WHERE id = ?`, durationMs, id)
	return err
}

// Albums returns grouped albums with the best available cover.
func (s *Store) Albums(limit, offset int) (AlbumPage, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	if offset < 0 {
		offset = 0
	}

	const group = `FROM tracks WHERE missing = 0 AND album <> '' GROUP BY album, album_artist`
	rows, err := s.db.Query(`
SELECT album, album_artist, COALESCE(MIN(NULLIF(year, 0)), 0),
       COUNT(*), COALESCE(SUM(duration_ms), 0),
       COALESCE(MIN(NULLIF(art_id, '')), ''), COALESCE(MIN(NULLIF(accent, '')), '')
`+group+` ORDER BY album COLLATE NOCASE, album_artist COLLATE NOCASE LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return AlbumPage{}, err
	}
	defer rows.Close()

	albums := make([]AlbumSummary, 0)
	for rows.Next() {
		var a AlbumSummary
		if err := rows.Scan(&a.Album, &a.AlbumArtist, &a.Year, &a.TrackCount, &a.DurationMs, &a.ArtID, &a.Accent); err != nil {
			return AlbumPage{}, err
		}
		albums = append(albums, a)
	}
	if err := rows.Err(); err != nil {
		return AlbumPage{}, err
	}

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM (SELECT 1 ` + group + `)`).Scan(&total); err != nil {
		return AlbumPage{}, err
	}
	return AlbumPage{Albums: albums, Total: total}, nil
}

// Artists returns grouped artists.
func (s *Store) Artists(limit, offset int) (ArtistPage, error) {
	if limit <= 0 {
		limit = 200
	}
	if limit > 2000 {
		limit = 2000
	}
	if offset < 0 {
		offset = 0
	}

	const group = `FROM tracks WHERE missing = 0 AND artist <> '' GROUP BY artist`
	rows, err := s.db.Query(`
SELECT artist, COUNT(*), COUNT(DISTINCT album),
       COALESCE(MIN(NULLIF(art_id, '')), ''), COALESCE(MIN(NULLIF(accent, '')), '')
`+group+` ORDER BY artist COLLATE NOCASE LIMIT ? OFFSET ?`, limit, offset)
	if err != nil {
		return ArtistPage{}, err
	}
	defer rows.Close()

	artists := make([]ArtistSummary, 0)
	for rows.Next() {
		var a ArtistSummary
		if err := rows.Scan(&a.Artist, &a.TrackCount, &a.AlbumCount, &a.ArtID, &a.Accent); err != nil {
			return ArtistPage{}, err
		}
		artists = append(artists, a)
	}
	if err := rows.Err(); err != nil {
		return ArtistPage{}, err
	}

	var total int
	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT artist) FROM tracks WHERE missing = 0 AND artist <> ''`).Scan(&total); err != nil {
		return ArtistPage{}, err
	}
	return ArtistPage{Artists: artists, Total: total}, nil
}

// AlbumRef identifies one grouped album row.
type AlbumRef struct {
	Album       string
	AlbumArtist string
}

// AlbumTrackCounts returns full-library track counts for the referenced
// albums. Search derives its album hits from a limited page of matching
// tracks, so the card counts have to come from the whole library.
func (s *Store) AlbumTrackCounts(refs []AlbumRef) (map[AlbumRef]int, error) {
	counts := make(map[AlbumRef]int, len(refs))
	if len(refs) == 0 {
		return counts, nil
	}
	placeholders := make([]string, len(refs))
	args := make([]any, 0, len(refs)*2)
	for i, ref := range refs {
		placeholders[i] = "(?, ?)"
		args = append(args, ref.Album, ref.AlbumArtist)
	}
	rows, err := s.db.Query(`
SELECT album, album_artist, COUNT(*) FROM tracks
WHERE missing = 0 AND (album, album_artist) IN (VALUES `+strings.Join(placeholders, ", ")+`)
GROUP BY album, album_artist`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var ref AlbumRef
		var count int
		if err := rows.Scan(&ref.Album, &ref.AlbumArtist, &count); err != nil {
			return nil, err
		}
		counts[ref] = count
	}
	return counts, rows.Err()
}

// ArtistTrackCounts returns full-library totals for the referenced artists,
// keyed by artist name.
func (s *Store) ArtistTrackCounts(names []string) (map[string]ArtistSummary, error) {
	counts := make(map[string]ArtistSummary, len(names))
	if len(names) == 0 {
		return counts, nil
	}
	placeholders := make([]string, len(names))
	args := make([]any, 0, len(names))
	for i, name := range names {
		placeholders[i] = "?"
		args = append(args, name)
	}
	rows, err := s.db.Query(`
SELECT artist, COUNT(*), COUNT(DISTINCT album),
       COALESCE(MIN(NULLIF(art_id, '')), ''), COALESCE(MIN(NULLIF(accent, '')), '')
FROM tracks WHERE missing = 0 AND artist IN (`+strings.Join(placeholders, ", ")+`)
GROUP BY artist`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var a ArtistSummary
		if err := rows.Scan(&a.Artist, &a.TrackCount, &a.AlbumCount, &a.ArtID, &a.Accent); err != nil {
			return nil, err
		}
		counts[a.Artist] = a
	}
	return counts, rows.Err()
}

// Genres returns grouped genres ordered by name.
func (s *Store) Genres() ([]GenreSummary, error) {
	rows, err := s.db.Query(`
SELECT genre, COUNT(*) FROM tracks
WHERE missing = 0 AND genre <> ''
GROUP BY genre ORDER BY genre COLLATE NOCASE`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	genres := make([]GenreSummary, 0)
	for rows.Next() {
		var g GenreSummary
		if err := rows.Scan(&g.Genre, &g.TrackCount); err != nil {
			return nil, err
		}
		genres = append(genres, g)
	}
	return genres, rows.Err()
}

// Stats aggregates the library counters.
func (s *Store) Stats() (Stats, error) {
	var st Stats
	if err := s.db.QueryRow(`
SELECT COALESCE(COUNT(*), 0), COALESCE(SUM(duration_ms), 0)
FROM tracks WHERE missing = 0`).Scan(&st.Tracks, &st.DurationMs); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`
SELECT COUNT(*) FROM (SELECT 1 FROM tracks
WHERE missing = 0 AND album <> '' GROUP BY album, album_artist)`).Scan(&st.Albums); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT artist) FROM tracks WHERE missing = 0 AND artist <> ''`).Scan(&st.Artists); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(DISTINCT genre) FROM tracks WHERE missing = 0 AND genre <> ''`).Scan(&st.Genres); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM folders`).Scan(&st.Folders); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM tracks WHERE missing = 0 AND liked = 1`).Scan(&st.Liked); err != nil {
		return Stats{}, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM tracks WHERE missing = 1`).Scan(&st.Missing); err != nil {
		return Stats{}, err
	}
	var last sql.NullInt64
	if err := s.db.QueryRow(`SELECT MAX(last_scan_at) FROM folders`).Scan(&last); err == nil && last.Valid {
		st.LastScanAt = last.Int64
	}
	return st, nil
}

// Setting reads a settings value; ok is false when the key is absent.
func (s *Store) Setting(key string) (string, bool, error) {
	var value string
	err := s.db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// SetSetting writes a settings value.
func (s *Store) SetSetting(key, value string) error {
	_, err := s.db.Exec(`
INSERT INTO settings (key, value) VALUES (?, ?)
ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value)
	return err
}

func nullableInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

func nullableString(v *string) any {
	if v == nil || *v == "" {
		return nil
	}
	return *v
}

func escapeLike(s string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(s)
}
