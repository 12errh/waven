package desktop

import (
	"os"
	"path/filepath"
	"testing"

	"waven/internal/store"
)

func newLibraryTestService(t *testing.T) (*LibraryService, *store.Store) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "waven.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return &LibraryService{store: st}, st
}

func resolvedPath(t *testing.T, path string) string {
	t.Helper()
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		t.Fatalf("EvalSymlinks(%q): %v", path, err)
	}
	return resolved
}

func TestImportDroppedPathsKeepsOutermostRoot(t *testing.T) {
	svc, _ := newLibraryTestService(t)
	root := t.TempDir()
	album := filepath.Join(root, "Album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	file := filepath.Join(album, "song.mp3")
	if err := os.WriteFile(file, []byte("not really audio"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got, err := svc.ImportDroppedPaths([]string{album, file, root})
	if err != nil {
		t.Fatalf("ImportDroppedPaths: %v", err)
	}
	want := resolvedPath(t, root)
	if len(got.Added) != 1 || got.Added[0] != want {
		t.Fatalf("Added = %v, want [%s]", got.Added, want)
	}
	if len(got.Existing) != 0 || len(got.Warnings) != 0 {
		t.Fatalf("unexpected result: %+v", got)
	}
	if len(got.Folders) != 1 || got.Folders[0].Path != want {
		t.Fatalf("Folders = %+v, want one folder at %s", got.Folders, want)
	}
}

func TestImportDroppedPathsSkipsExistingRoots(t *testing.T) {
	svc, st := newLibraryTestService(t)
	root := t.TempDir()
	child := filepath.Join(root, "Live")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	resolvedRoot := resolvedPath(t, root)
	if _, err := st.AddFolder(resolvedRoot); err != nil {
		t.Fatalf("AddFolder: %v", err)
	}

	got, err := svc.ImportDroppedPaths([]string{child, resolvedRoot})
	if err != nil {
		t.Fatalf("ImportDroppedPaths: %v", err)
	}
	if len(got.Added) != 0 {
		t.Fatalf("Added = %v, want none", got.Added)
	}
	if len(got.Existing) != 1 || got.Existing[0] != resolvedRoot {
		t.Fatalf("Existing = %v, want [%s]", got.Existing, resolvedRoot)
	}
}

func TestImportDroppedPathsRejectsParentOfExistingRoot(t *testing.T) {
	svc, st := newLibraryTestService(t)
	root := t.TempDir()
	child := filepath.Join(root, "Live")
	if err := os.MkdirAll(child, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	if _, err := st.AddFolder(resolvedPath(t, child)); err != nil {
		t.Fatalf("AddFolder: %v", err)
	}

	got, err := svc.ImportDroppedPaths([]string{root})
	if err != nil {
		t.Fatalf("ImportDroppedPaths: %v", err)
	}
	if len(got.Added) != 0 || len(got.Warnings) != 1 {
		t.Fatalf("result = %+v, want one warning and nothing added", got)
	}
}

func TestImportDroppedPathsRequiresPaths(t *testing.T) {
	svc, _ := newLibraryTestService(t)
	if _, err := svc.ImportDroppedPaths(nil); err == nil {
		t.Fatal("ImportDroppedPaths(nil) should fail")
	}
}

func TestLibraryServicePlaylistBindings(t *testing.T) {
	svc, st := newLibraryTestService(t)
	folder, err := st.AddFolder("/music")
	if err != nil {
		t.Fatalf("AddFolder: %v", err)
	}
	if err := st.UpsertTracks([]store.TrackRecord{{
		FolderID:     folder.ID,
		Path:         "/music/one.mp3",
		Title:        "One",
		Format:       "mp3",
		LastSeenScan: 1,
	}}); err != nil {
		t.Fatalf("UpsertTracks: %v", err)
	}
	page, err := st.ListTracks(store.TrackFilter{Limit: 10})
	if err != nil || len(page.Tracks) != 1 {
		t.Fatalf("ListTracks = %+v, %v", page, err)
	}
	trackID := page.Tracks[0].ID

	created, err := svc.CreatePlaylist("  Evening Drive  ", []int64{trackID})
	if err != nil {
		t.Fatalf("CreatePlaylist: %v", err)
	}
	if created.Name != "Evening Drive" {
		t.Fatalf("Name = %q, want trimmed", created.Name)
	}
	if len(created.TrackIDs) != 1 || created.TrackIDs[0] != trackID {
		t.Fatalf("TrackIDs = %v, want [%d]", created.TrackIDs, trackID)
	}

	if err := svc.RenamePlaylist(created.ID, "Night Drive"); err != nil {
		t.Fatalf("RenamePlaylist: %v", err)
	}
	list, err := svc.GetPlaylists()
	if err != nil {
		t.Fatalf("GetPlaylists: %v", err)
	}
	if len(list) != 1 || list[0].Name != "Night Drive" {
		t.Fatalf("GetPlaylists = %+v", list)
	}

	// Adding the same track is idempotent, and reordering the single entry is
	// valid because it matches the current contents.
	if err := svc.AddTrackToPlaylist(created.ID, trackID); err != nil {
		t.Fatalf("AddTrackToPlaylist: %v", err)
	}
	if err := svc.ReorderPlaylist(created.ID, []int64{trackID}); err != nil {
		t.Fatalf("ReorderPlaylist: %v", err)
	}
	if err := svc.RemoveFromPlaylist(created.ID, trackID); err != nil {
		t.Fatalf("RemoveFromPlaylist: %v", err)
	}
	if err := svc.DeletePlaylist(created.ID); err != nil {
		t.Fatalf("DeletePlaylist: %v", err)
	}
	list, err = svc.GetPlaylists()
	if err != nil {
		t.Fatalf("GetPlaylists after delete: %v", err)
	}
	if len(list) != 0 {
		t.Fatalf("playlists remain after delete: %+v", list)
	}

	if _, err := svc.CreatePlaylist("   ", nil); err == nil {
		t.Fatal("CreatePlaylist with a blank name should fail")
	}
}
