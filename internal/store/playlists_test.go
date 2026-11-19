package store

import (
	"testing"
)

func seedPlaylistTracks(t *testing.T, st *Store, count int) []Track {
	t.Helper()
	folder, err := st.AddFolder("/music")
	if err != nil {
		t.Fatalf("AddFolder: %v", err)
	}
	records := make([]TrackRecord, 0, count)
	for i := 0; i < count; i++ {
		records = append(records, sampleRecord(
			folder.ID,
			"/music/track-"+string(rune('a'+i))+".mp3",
			"Track "+string(rune('A'+i)),
			"Artist",
			"Album",
			1,
		))
	}
	if err := st.UpsertTracks(records); err != nil {
		t.Fatalf("UpsertTracks: %v", err)
	}
	page, err := st.ListTracks(TrackFilter{Sort: "title", Limit: 100})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	return page.Tracks
}

func TestPlaylistLifecycle(t *testing.T) {
	st := openTestStore(t)
	tracks := seedPlaylistTracks(t, st, 3)
	if len(tracks) != 3 {
		t.Fatalf("seeded %d tracks, want 3", len(tracks))
	}

	created, err := st.CreatePlaylist("Evening Drive", []int64{tracks[2].ID, tracks[0].ID}, 1000)
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if created.ID == 0 || created.Name != "Evening Drive" {
		t.Fatalf("created = %+v", created)
	}
	if len(created.TrackIDs) != 2 || created.TrackIDs[0] != tracks[2].ID || created.TrackIDs[1] != tracks[0].ID {
		t.Fatalf("track order = %v, want [%d %d]", created.TrackIDs, tracks[2].ID, tracks[0].ID)
	}
	if created.CreatedAt != 1000 {
		t.Fatalf("CreatedAt = %d, want 1000", created.CreatedAt)
	}

	if err := st.AddPlaylistTrack(created.ID, tracks[1].ID); err != nil {
		t.Fatalf("AddPlaylistTrack: %v", err)
	}
	// Adding the same track is idempotent.
	if err := st.AddPlaylistTrack(created.ID, tracks[1].ID); err != nil {
		t.Fatalf("AddPlaylistTrack repeat: %v", err)
	}
	got, err := st.GetPlaylist(created.ID)
	if err != nil {
		t.Fatalf("GetPlaylist: %v", err)
	}
	if len(got.TrackIDs) != 3 || got.TrackIDs[2] != tracks[1].ID {
		t.Fatalf("TrackIDs after add = %v", got.TrackIDs)
	}

	if err := st.RenamePlaylist(created.ID, "Night Drive"); err != nil {
		t.Fatalf("RenamePlaylist: %v", err)
	}
	if err := st.ReorderPlaylistTracks(created.ID, []int64{tracks[1].ID, tracks[2].ID, tracks[0].ID}); err != nil {
		t.Fatalf("ReorderPlaylistTracks: %v", err)
	}
	got, err = st.GetPlaylist(created.ID)
	if err != nil {
		t.Fatalf("GetPlaylist: %v", err)
	}
	if got.Name != "Night Drive" {
		t.Fatalf("Name = %q", got.Name)
	}
	want := []int64{tracks[1].ID, tracks[2].ID, tracks[0].ID}
	for i := range want {
		if got.TrackIDs[i] != want[i] {
			t.Fatalf("TrackIDs after reorder = %v, want %v", got.TrackIDs, want)
		}
	}

	// A reorder that does not match the current set is rejected.
	if err := st.ReorderPlaylistTracks(created.ID, []int64{tracks[0].ID, tracks[1].ID}); err == nil {
		t.Fatal("ReorderPlaylistTracks accepted a stale set")
	}

	if err := st.RemovePlaylistTrack(created.ID, tracks[2].ID); err != nil {
		t.Fatalf("RemovePlaylistTrack: %v", err)
	}
	got, _ = st.GetPlaylist(created.ID)
	if len(got.TrackIDs) != 2 {
		t.Fatalf("TrackIDs after remove = %v", got.TrackIDs)
	}

	all, err := st.ListPlaylists()
	if err != nil || len(all) != 1 {
		t.Fatalf("ListPlaylists = %v, %v", all, err)
	}

	if err := st.DeletePlaylist(created.ID); err != nil {
		t.Fatalf("DeletePlaylist: %v", err)
	}
	if _, err := st.GetPlaylist(created.ID); err != ErrNotFound {
		t.Fatalf("GetPlaylist after delete = %v, want ErrNotFound", err)
	}
	if err := st.DeletePlaylist(created.ID); err != ErrNotFound {
		t.Fatalf("DeletePlaylist repeat = %v, want ErrNotFound", err)
	}
}

func TestPlaylistSkipsMissingTracksAndPrunesOnDelete(t *testing.T) {
	st := openTestStore(t)
	tracks := seedPlaylistTracks(t, st, 2)

	created, err := st.CreatePlaylist("Favorites", []int64{tracks[0].ID, tracks[1].ID}, 0)
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if len(created.TrackIDs) != 2 {
		t.Fatalf("TrackIDs = %v", created.TrackIDs)
	}

	// Removing the root cascades tracks and their playlist rows.
	folders, _ := st.ListFolders()
	if err := st.RemoveFolder(folders[0].ID); err != nil {
		t.Fatalf("RemoveFolder: %v", err)
	}
	got, err := st.GetPlaylist(created.ID)
	if err != nil {
		t.Fatalf("GetPlaylist after folder removal: %v", err)
	}
	if len(got.TrackIDs) != 0 {
		t.Fatalf("TrackIDs after folder removal = %v", got.TrackIDs)
	}
}

func TestImportLegacyPlaylistsRunsOnce(t *testing.T) {
	st := openTestStore(t)
	tracks := seedPlaylistTracks(t, st, 2)

	imports := []PlaylistImport{
		{Name: "Old Mix", TrackIDs: []int64{tracks[0].ID}, CreatedAt: 500},
		{Name: "Older Mix", TrackIDs: []int64{tracks[1].ID, 9999}, CreatedAt: 400},
	}
	count, err := st.ImportLegacyPlaylists(imports)
	if err != nil {
		t.Fatalf("ImportLegacyPlaylists: %v", err)
	}
	if count != 2 {
		t.Fatalf("imported = %d, want 2", count)
	}
	all, err := st.ListPlaylists()
	if err != nil || len(all) != 2 {
		t.Fatalf("ListPlaylists = %v, %v", all, err)
	}
	// The missing ID is skipped but the valid one is kept.
	for _, playlist := range all {
		if playlist.Name == "Older Mix" && len(playlist.TrackIDs) != 1 {
			t.Fatalf("Older Mix tracks = %v", playlist.TrackIDs)
		}
	}

	// The marker prevents a second import, even with new data.
	count, err = st.ImportLegacyPlaylists([]PlaylistImport{{Name: "Duplicate"}})
	if err != nil {
		t.Fatalf("ImportLegacyPlaylists repeat: %v", err)
	}
	if count != 0 {
		t.Fatalf("second import count = %d, want 0", count)
	}
	all, _ = st.ListPlaylists()
	if len(all) != 2 {
		t.Fatalf("playlists after second import = %v", all)
	}
}
