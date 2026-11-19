package desktop

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"waven/internal/store"
)

func newPlayerTestService(t *testing.T) (*PlayerService, *store.Store, int64, []store.Track) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "waven.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	folder, err := st.AddFolder("/music")
	if err != nil {
		t.Fatalf("AddFolder: %v", err)
	}
	year, trackNo, discNo := 2024, 1, 1
	bitrate, sampleRate, channels := 320, 44100, 2
	records := make([]store.TrackRecord, 0, 3)
	for index, title := range []string{"Alpha", "Beta", "Gamma"} {
		records = append(records, store.TrackRecord{
			FolderID:     folder.ID,
			Path:         filepath.Join("/music", title+".mp3"),
			Title:        title,
			Artist:       "Artist",
			Album:        "Album",
			AlbumArtist:  "Artist",
			Genre:        "Pop",
			Year:         &year,
			TrackNo:      &trackNo,
			DiscNo:       &discNo,
			DurationMs:   200_000 + int64(index)*1_000,
			BitrateKbps:  &bitrate,
			SampleRate:   &sampleRate,
			Channels:     &channels,
			Format:       "mp3",
			SizeBytes:    1_000_000,
			MTime:        1_700_000_000_000,
			SearchText:   title,
			LastSeenScan: 1,
		})
	}
	if err := st.UpsertTracks(records); err != nil {
		t.Fatalf("UpsertTracks: %v", err)
	}
	page, err := st.ListTracks(store.TrackFilter{Sort: "title"})
	if err != nil {
		t.Fatalf("ListTracks: %v", err)
	}
	library := &LibraryService{store: st}
	service, err := NewPlayerService(nil, library, nil)
	if err != nil {
		t.Fatalf("NewPlayerService: %v", err)
	}
	return service, st, folder.ID, page.Tracks
}

func TestPlayerSessionDefaults(t *testing.T) {
	service, _, _, _ := newPlayerTestService(t)
	session, err := service.GetSession()
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if session.TrackID != 0 || len(session.QueueIDs) != 0 {
		t.Fatalf("default session = %+v", session)
	}
	if session.Repeat != "off" || session.Volume != 0.8 {
		t.Fatalf("default repeat/volume = %+v", session)
	}
}

func TestPlayerSessionRoundTripAndPruning(t *testing.T) {
	service, st, folderID, tracks := newPlayerTestService(t)
	ids := []int64{tracks[0].ID, tracks[1].ID, tracks[2].ID}

	saved := PlayerSession{
		TrackID:      ids[1],
		PositionMs:   45_000,
		QueueIDs:     ids,
		QueueIndex:   1,
		Shuffle:      true,
		ShuffleOrder: []int64{ids[1], ids[0], ids[2]},
		Repeat:       "all",
		Volume:       0.65,
		Muted:        false,
	}
	if err := service.SaveSession(saved); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}

	got, err := service.GetSession()
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if got.TrackID != ids[1] || got.PositionMs != 45_000 || got.QueueIndex != 1 {
		t.Fatalf("restored session = %+v", got)
	}
	if got.Repeat != "all" || got.Volume != 0.65 || !got.Shuffle {
		t.Fatalf("restored modes = %+v", got)
	}
	if len(got.ShuffleOrder) != 3 || got.ShuffleOrder[0] != ids[1] {
		t.Fatalf("restored shuffle order = %+v", got.ShuffleOrder)
	}
	if got.UpdatedAt == 0 {
		t.Fatal("session UpdatedAt was not stamped")
	}

	// Mark the active middle track missing. The queue keeps the others and the
	// saved index falls forward to the next available entry.
	if err := st.TouchTracks(folderID, 2, []string{tracks[0].Path, tracks[2].Path}); err != nil {
		t.Fatalf("TouchTracks: %v", err)
	}
	if _, err := st.MarkMissing(folderID, 2); err != nil {
		t.Fatalf("MarkMissing: %v", err)
	}
	got, err = service.GetSession()
	if err != nil {
		t.Fatalf("GetSession after prune: %v", err)
	}
	if len(got.QueueIDs) != 2 || got.QueueIDs[0] != ids[0] || got.QueueIDs[1] != ids[2] {
		t.Fatalf("pruned queue = %+v", got.QueueIDs)
	}
	if got.TrackID != ids[2] {
		t.Fatalf("fall-forward track = %d, want %d", got.TrackID, ids[2])
	}
	if got.PositionMs != 0 {
		t.Fatalf("fall-forward position = %d, want 0", got.PositionMs)
	}
	if len(got.ShuffleOrder) != 2 || got.ShuffleOrder[0] != ids[0] || got.ShuffleOrder[1] != ids[2] {
		t.Fatalf("pruned shuffle order = %+v", got.ShuffleOrder)
	}

	// Corrupt JSON must never stop the app from starting.
	if err := st.SetSetting(playerSessionKey, "{not json"); err != nil {
		t.Fatalf("SetSetting: %v", err)
	}
	got, err = service.GetSession()
	if err != nil {
		t.Fatalf("GetSession corrupt: %v", err)
	}
	if got.TrackID != 0 || len(got.QueueIDs) != 0 || got.Repeat != "off" {
		t.Fatalf("corrupt session fallback = %+v", got)
	}
}

func TestPlayerRecordPlayValidation(t *testing.T) {
	service, st, _, tracks := newPlayerTestService(t)
	if err := service.RecordPlay(0, 0); err == nil {
		t.Fatal("RecordPlay accepted an empty track id")
	}
	if err := service.RecordPlay(999_999, 30_000); err == nil {
		t.Fatal("RecordPlay accepted a non-existent track")
	}
	if err := service.RecordPlay(tracks[0].ID, 30_000); err != nil {
		t.Fatalf("RecordPlay: %v", err)
	}
	recent, err := st.RecentlyPlayed(10)
	if err != nil {
		t.Fatalf("RecentlyPlayed: %v", err)
	}
	if len(recent) != 1 || recent[0].ID != tracks[0].ID {
		t.Fatalf("recent plays = %+v", recent)
	}
}

func TestPlayerShutdownFlushesLatestPosition(t *testing.T) {
	service, st, _, tracks := newPlayerTestService(t)
	ids := []int64{tracks[0].ID, tracks[1].ID}
	if err := service.SaveSession(PlayerSession{
		TrackID:    ids[0],
		PositionMs: 1_000,
		QueueIDs:   ids,
		QueueIndex: 0,
		Repeat:     "off",
		Volume:     0.5,
	}); err != nil {
		t.Fatalf("SaveSession: %v", err)
	}
	if err := service.UpdateState(PlayerState{
		TrackID:    ids[0],
		Title:      tracks[0].Title,
		PositionMs: 42_000,
		DurationMs: 200_000,
		Playing:    true,
	}); err != nil {
		t.Fatalf("UpdateState: %v", err)
	}
	if err := service.ServiceShutdown(); err != nil {
		t.Fatalf("ServiceShutdown: %v", err)
	}

	raw, ok, err := st.Setting(playerSessionKey)
	if err != nil || !ok {
		t.Fatalf("read session setting: ok=%v err=%v", ok, err)
	}
	var persisted PlayerSession
	if err := json.Unmarshal([]byte(raw), &persisted); err != nil {
		t.Fatalf("unmarshal session: %v", err)
	}
	if persisted.PositionMs != 42_000 || persisted.TrackID != ids[0] {
		t.Fatalf("shutdown session = %+v", persisted)
	}
}
