package store

import (
	"path/filepath"
	"testing"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "library", "waven.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func intPtr(v int) *int       { return &v }
func strPtr(v string) *string { return &v }

func sampleRecord(folderID int64, path, title, artist, album string, scan int64) TrackRecord {
	return TrackRecord{
		FolderID:     folderID,
		Path:         path,
		Title:        title,
		Artist:       artist,
		Album:        album,
		AlbumArtist:  artist,
		Genre:        "Electronic",
		Year:         intPtr(2001),
		TrackNo:      intPtr(1),
		DiscNo:       intPtr(1),
		DurationMs:   215000,
		BitrateKbps:  intPtr(320),
		SampleRate:   intPtr(44100),
		Channels:     intPtr(2),
		Format:       "mp3",
		SizeBytes:    8_000_000,
		MTime:        1_700_000_000_000,
		ArtID:        strPtr("abc"),
		Accent:       strPtr("#336699"),
		SearchText:   "search " + title,
		LastSeenScan: scan,
	}
}

func TestFolderLifecycle(t *testing.T) {
	st := openTestStore(t)

	folder, err := st.AddFolder("/music")
	if err != nil {
		t.Fatalf("AddFolder: %v", err)
	}
	if folder.ID == 0 || folder.Path != "/music" {
		t.Fatalf("unexpected folder: %+v", folder)
	}
	// Re-adding the same root is idempotent.
	again, err := st.AddFolder("/music")
	if err != nil || again.ID != folder.ID {
		t.Fatalf("AddFolder repeat = %+v, %v", again, err)
	}

	if err := st.SetFolderLastScan(folder.ID, 1234); err != nil {
		t.Fatal(err)
	}
	got, err := st.GetFolder(folder.ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.LastScanAt == nil || *got.LastScanAt != 1234 {
		t.Fatalf("LastScanAt = %v", got.LastScanAt)
	}

	folders, err := st.ListFolders()
	if err != nil || len(folders) != 1 {
		t.Fatalf("ListFolders = %v, %v", folders, err)
	}
	if err := st.RemoveFolder(folder.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := st.GetFolder(folder.ID); err != ErrNotFound {
		t.Fatalf("GetFolder after remove = %v, want ErrNotFound", err)
	}
}

func TestUpsertTracksKeepsLikesAndAddedAt(t *testing.T) {
	st := openTestStore(t)
	folder, _ := st.AddFolder("/music")
	record := sampleRecord(folder.ID, "/music/a.mp3", "Alpha", "Artist", "Album", 100)

	if err := st.UpsertTracks([]TrackRecord{record}); err != nil {
		t.Fatalf("UpsertTracks: %v", err)
	}
	page, err := st.ListTracks(TrackFilter{})
	if err != nil || page.Total != 1 || len(page.Tracks) != 1 {
		t.Fatalf("ListTracks = %+v, %v", page, err)
	}
	track := page.Tracks[0]
	if track.Liked || track.Missing {
		t.Fatalf("unexpected flags: %+v", track)
	}
	if track.ArtID != "abc" || track.Accent != "#336699" {
		t.Fatalf("art fields = %+v", track)
	}
	addedAt := track.AddedAt

	if err := st.SetLiked(track.ID, true); err != nil {
		t.Fatal(err)
	}
	record.Title = "Alpha Remastered"
	record.LastSeenScan = 200
	if err := st.UpsertTracks([]TrackRecord{record}); err != nil {
		t.Fatal(err)
	}
	updated, err := st.GetTrack(track.ID)
	if err != nil {
		t.Fatal(err)
	}
	if updated.Title != "Alpha Remastered" {
		t.Fatalf("Title = %q", updated.Title)
	}
	if !updated.Liked {
		t.Fatal("upsert cleared the liked flag")
	}
	if updated.AddedAt != addedAt {
		t.Fatalf("AddedAt changed: %d -> %d", addedAt, updated.AddedAt)
	}
	if updated.LastSeen != 200 {
		t.Fatalf("LastSeen = %d", updated.LastSeen)
	}
}

func TestTrackFiltersAndSearch(t *testing.T) {
	st := openTestStore(t)
	folder, _ := st.AddFolder("/music")
	records := []TrackRecord{
		sampleRecord(folder.ID, "/music/a.mp3", "Aerodynamic", "Daft Punk", "Discovery", 1),
		sampleRecord(folder.ID, "/music/b.mp3", "Nightcall", "Kavinsky", "OutRun", 1),
		sampleRecord(folder.ID, "/music/c.mp3", "Jóga", "Björk", "Homogenic", 1),
	}
	tracks := []struct{ artist, album, genre string }{
		{"Daft Punk", "Discovery", "Electronic"},
		{"Kavinsky", "OutRun", "Synthwave"},
		{"Björk", "Homogenic", "Art Pop"},
	}
	for i := range records {
		records[i].Artist = tracks[i].artist
		records[i].Album = tracks[i].album
		records[i].AlbumArtist = tracks[i].artist
		records[i].Genre = tracks[i].genre
	}
	// search_text is stored normalized by the scanner.
	records[0].SearchText = "aerodynamic daft punk discovery"
	records[1].SearchText = "nightcall kavinsky outrun"
	records[2].SearchText = "joga bjork homogenic"
	if err := st.UpsertTracks(records); err != nil {
		t.Fatal(err)
	}

	page, err := st.ListTracks(TrackFilter{Text: "joga", Sort: "title"})
	if err != nil || page.Total != 1 || page.Tracks[0].Title != "Jóga" {
		t.Fatalf("accent-folded search = %+v, %v", page, err)
	}

	page, err = st.ListTracks(TrackFilter{Text: "kavinsky"})
	if err != nil || page.Total != 1 || page.Tracks[0].Title != "Nightcall" {
		t.Fatalf("artist search = %+v, %v", page, err)
	}

	page, err = st.ListTracks(TrackFilter{Artist: "Daft Punk"})
	if err != nil || page.Total != 1 {
		t.Fatalf("artist filter = %+v, %v", page, err)
	}
	page, err = st.ListTracks(TrackFilter{Album: "Discovery", AlbumArtist: "Daft Punk"})
	if err != nil || page.Total != 1 {
		t.Fatalf("album filter = %+v, %v", page, err)
	}
	page, err = st.ListTracks(TrackFilter{Genre: "Art Pop"})
	if err != nil || page.Total != 1 || page.Tracks[0].Title != "Jóga" {
		t.Fatalf("genre filter = %+v, %v", page, err)
	}

	// LIKE wildcards in user input must be escaped.
	page, err = st.ListTracks(TrackFilter{Text: "%"})
	if err != nil || page.Total != 0 {
		t.Fatalf("wildcard search = %+v, %v", page, err)
	}

	// Paging keeps the full count.
	page, err = st.ListTracks(TrackFilter{Sort: "title", Limit: 2})
	if err != nil || len(page.Tracks) != 2 || page.Total != 3 {
		t.Fatalf("paged search = %+v, %v", page, err)
	}
}

func TestAlbumsArtistsGenresAndStats(t *testing.T) {
	st := openTestStore(t)
	folder, _ := st.AddFolder("/music")
	records := []TrackRecord{
		sampleRecord(folder.ID, "/music/1.mp3", "One", "Artist A", "Album X", 1),
		sampleRecord(folder.ID, "/music/2.mp3", "Two", "Artist A", "Album X", 1),
		sampleRecord(folder.ID, "/music/3.mp3", "Three", "Artist B", "Album Y", 1),
	}
	records[0].ArtID = nil
	records[1].ArtID = strPtr("cover-x")
	records[1].Accent = strPtr("#111111")
	if err := st.UpsertTracks(records); err != nil {
		t.Fatal(err)
	}

	albums, err := st.Albums(0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if albums.Total != 2 || len(albums.Albums) != 2 {
		t.Fatalf("Albums = %+v", albums)
	}
	var albumX AlbumSummary
	for _, a := range albums.Albums {
		if a.Album == "Album X" {
			albumX = a
		}
	}
	if albumX.TrackCount != 2 || albumX.ArtID != "cover-x" {
		t.Fatalf("album X = %+v", albumX)
	}

	artists, err := st.Artists(0, 0)
	if err != nil || artists.Total != 2 {
		t.Fatalf("Artists = %+v, %v", artists, err)
	}
	genres, err := st.Genres()
	if err != nil || len(genres) != 1 || genres[0].TrackCount != 3 {
		t.Fatalf("Genres = %+v, %v", genres, err)
	}

	stats, err := st.Stats()
	if err != nil {
		t.Fatal(err)
	}
	if stats.Tracks != 3 || stats.Albums != 2 || stats.Artists != 2 || stats.Genres != 1 || stats.Folders != 1 {
		t.Fatalf("Stats = %+v", stats)
	}
	if stats.DurationMs != 3*215000 {
		t.Fatalf("DurationMs = %d", stats.DurationMs)
	}
}

func TestAlbumAndArtistTrackCounts(t *testing.T) {
	st := openTestStore(t)
	folder, _ := st.AddFolder("/music")
	records := []TrackRecord{
		sampleRecord(folder.ID, "/music/1.mp3", "One", "Artist A", "Album X", 1),
		sampleRecord(folder.ID, "/music/2.mp3", "Two", "Artist A", "Album X", 1),
		sampleRecord(folder.ID, "/music/3.mp3", "Three", "Artist A", "Album X", 1),
		sampleRecord(folder.ID, "/music/4.mp3", "Four", "Artist B", "Album Y", 1),
		sampleRecord(folder.ID, "/music/5.mp3", "Five", "Artist B", "Album Y", 1),
		sampleRecord(folder.ID, "/music/6.mp3", "Six", "Artist B", "Album Y", 1),
	}
	if err := st.UpsertTracks(records); err != nil {
		t.Fatal(err)
	}
	// Mark the last track missing by completing a scan that saw only the first five.
	if err := st.TouchTracks(folder.ID, 2, []string{
		"/music/1.mp3", "/music/2.mp3", "/music/3.mp3", "/music/4.mp3", "/music/5.mp3",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := st.MarkMissing(folder.ID, 2); err != nil {
		t.Fatal(err)
	}

	albumRefs := []AlbumRef{
		{Album: "Album X", AlbumArtist: "Artist A"},
		{Album: "Album Y", AlbumArtist: "Artist B"},
		{Album: "Missing", AlbumArtist: "Nobody"},
	}
	albumCounts, err := st.AlbumTrackCounts(albumRefs)
	if err != nil {
		t.Fatalf("AlbumTrackCounts: %v", err)
	}
	if got := albumCounts[albumRefs[0]]; got != 3 {
		t.Fatalf("Album X count = %d, want 3", got)
	}
	if got := albumCounts[albumRefs[1]]; got != 2 {
		t.Fatalf("Album Y count = %d, want 2 (missing track excluded)", got)
	}
	if got, ok := albumCounts[albumRefs[2]]; ok || got != 0 {
		t.Fatalf("missing album count = %d, %v", got, ok)
	}

	artistCounts, err := st.ArtistTrackCounts([]string{"Artist A", "Artist B", "Nobody"})
	if err != nil {
		t.Fatalf("ArtistTrackCounts: %v", err)
	}
	if a := artistCounts["Artist A"]; a.TrackCount != 3 || a.AlbumCount != 1 {
		t.Fatalf("Artist A = %+v", a)
	}
	if b := artistCounts["Artist B"]; b.TrackCount != 2 || b.AlbumCount != 1 {
		t.Fatalf("Artist B = %+v", b)
	}
	if _, ok := artistCounts["Nobody"]; ok {
		t.Fatal("unexpected count for unknown artist")
	}

	emptyAlbums, err := st.AlbumTrackCounts(nil)
	if err != nil || len(emptyAlbums) != 0 {
		t.Fatalf("AlbumTrackCounts(nil) = %+v, %v", emptyAlbums, err)
	}
	emptyArtists, err := st.ArtistTrackCounts(nil)
	if err != nil || len(emptyArtists) != 0 {
		t.Fatalf("ArtistTrackCounts(nil) = %+v, %v", emptyArtists, err)
	}
}

func TestMissingTracksAndFolderCascade(t *testing.T) {
	st := openTestStore(t)
	folder, _ := st.AddFolder("/music")
	records := []TrackRecord{
		sampleRecord(folder.ID, "/music/keep.mp3", "Keep", "A", "X", 50),
		sampleRecord(folder.ID, "/music/gone.mp3", "Gone", "A", "X", 10),
	}
	if err := st.UpsertTracks(records); err != nil {
		t.Fatal(err)
	}

	states, err := st.FileStates(folder.ID)
	if err != nil || len(states) != 2 {
		t.Fatalf("FileStates = %+v, %v", states, err)
	}
	if st := states["/music/keep.mp3"]; st.SizeBytes != 8_000_000 || st.Missing {
		t.Fatalf("state = %+v", st)
	}

	missing, err := st.MarkMissing(folder.ID, 50)
	if err != nil || missing != 1 {
		t.Fatalf("MarkMissing = %d, %v", missing, err)
	}
	page, err := st.ListTracks(TrackFilter{})
	if err != nil || page.Total != 1 || page.Tracks[0].Title != "Keep" {
		t.Fatalf("visible tracks = %+v, %v", page, err)
	}
	all, err := st.ListTracks(TrackFilter{IncludeMissing: true})
	if err != nil || all.Total != 2 {
		t.Fatalf("all tracks = %+v, %v", all, err)
	}

	if err := st.RemoveFolder(folder.ID); err != nil {
		t.Fatal(err)
	}
	all, err = st.ListTracks(TrackFilter{IncludeMissing: true})
	if err != nil || all.Total != 0 {
		t.Fatalf("tracks after folder removal = %+v, %v", all, err)
	}
}

func TestSettings(t *testing.T) {
	st := openTestStore(t)
	if _, ok, err := st.Setting("missing"); err != nil || ok {
		t.Fatalf("Setting(missing) = %v, %v", ok, err)
	}
	if err := st.SetSetting("library.lastScanAt", "42"); err != nil {
		t.Fatal(err)
	}
	value, ok, err := st.Setting("library.lastScanAt")
	if err != nil || !ok || value != "42" {
		t.Fatalf("Setting = %q, %v, %v", value, ok, err)
	}
	if err := st.SetSetting("library.lastScanAt", "43"); err != nil {
		t.Fatal(err)
	}
	if value, _, _ := st.Setting("library.lastScanAt"); value != "43" {
		t.Fatalf("Setting after update = %q", value)
	}
}
