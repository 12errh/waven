package library

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"waven/internal/store"
)

func newTestScanner(t *testing.T) (*Scanner, *store.Store, *ArtworkCache) {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "waven.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	cache, err := NewArtworkCache(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return &Scanner{Store: st, Artwork: cache, Workers: 2}, st, cache
}

func TestScannerIncrementalScan(t *testing.T) {
	root := t.TempDir()
	writeWAV(t, filepath.Join(root, "Daft Punk - Aerodynamic.wav"), 1)
	writeWAV(t, filepath.Join(root, "02 - Nightcall.wav"), 2)
	writeWAV(t, filepath.Join(root, "Bare.wav"), 1)
	writeWebM(t, filepath.Join(root, "partial.temp.webm"), 1)
	if err := os.WriteFile(filepath.Join(root, "notes.txt"), []byte("not audio"), 0o644); err != nil {
		t.Fatal(err)
	}
	hidden := filepath.Join(root, ".hidden")
	if err := os.MkdirAll(hidden, 0o755); err != nil {
		t.Fatal(err)
	}
	writeWAV(t, filepath.Join(hidden, "skip.wav"), 1)

	scanner, st, cache := newTestScanner(t)
	folder, err := st.AddFolder(root)
	if err != nil {
		t.Fatal(err)
	}

	var progress []Progress
	scanner.Progress = func(p Progress) { progress = append(progress, p) }

	summary, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatalf("first scan: %v", err)
	}
	if summary.Added != 3 || summary.Skipped != 0 || summary.Missing != 0 || summary.Canceled {
		t.Fatalf("first scan summary = %+v", summary)
	}
	if len(summary.Errors) != 0 {
		t.Fatalf("first scan errors = %+v", summary.Errors)
	}

	page, err := st.ListTracks(store.TrackFilter{Sort: "title"})
	if err != nil || page.Total != 3 {
		t.Fatalf("tracks = %+v, %v", page, err)
	}
	byTitle := map[string]store.Track{}
	for _, track := range page.Tracks {
		byTitle[track.Title] = track
	}
	aero, ok := byTitle["Aerodynamic"]
	if !ok {
		t.Fatalf("missing filename-fallback track: %+v", byTitle)
	}
	if aero.Artist != "Daft Punk" || aero.Format != "wav" {
		t.Fatalf("Aerodynamic = %+v", aero)
	}
	if aero.DurationMs < 995 || aero.DurationMs > 1005 {
		t.Fatalf("Aerodynamic duration = %d", aero.DurationMs)
	}
	night, ok := byTitle["Nightcall"]
	if !ok || night.TrackNo != 2 {
		t.Fatalf("Nightcall = %+v", night)
	}
	if bare, ok := byTitle["Bare"]; !ok || bare.DurationMs != 1000 {
		t.Fatalf("Bare = %+v", bare)
	}

	if got := countPhase(progress, phaseDone); got != 1 {
		t.Fatalf("done progress events = %d", got)
	}
	if got := countPhase(progress, phaseScanning); got == 0 {
		t.Fatal("no scanning progress events")
	}

	// Second scan: same size and mtime must skip parsing entirely.
	second, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatalf("second scan: %v", err)
	}
	if second.Added != 0 || second.Updated != 0 || second.Skipped != 3 {
		t.Fatalf("second scan summary = %+v", second)
	}
	if second.Missing != 0 {
		t.Fatalf("second scan marked tracks missing: %+v", second)
	}

	// Rewrite one file so its size changes: only that file is reparsed.
	writeWAV(t, filepath.Join(root, "Bare.wav"), 3)
	third, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatal(err)
	}
	if third.Updated != 1 || third.Skipped != 2 || third.Added != 0 {
		t.Fatalf("third scan summary = %+v", third)
	}
	updated, err := st.ListTracks(store.TrackFilter{Text: "bare"})
	if err != nil || updated.Total != 1 {
		t.Fatalf("updated track = %+v, %v", updated, err)
	}
	if updated.Tracks[0].DurationMs != 3000 {
		t.Fatalf("updated duration = %d", updated.Tracks[0].DurationMs)
	}

	// Delete a file: it is flagged missing and dropped from normal queries.
	if err := os.Remove(filepath.Join(root, "02 - Nightcall.wav")); err != nil {
		t.Fatal(err)
	}
	fourth, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatal(err)
	}
	if fourth.Removed != 1 || fourth.Missing != 1 || fourth.Skipped != 2 {
		t.Fatalf("fourth scan summary = %+v", fourth)
	}
	visible, err := st.ListTracks(store.TrackFilter{})
	if err != nil || visible.Total != 2 {
		t.Fatalf("visible after delete = %+v, %v", visible, err)
	}
	stats, err := st.Stats()
	if err != nil || stats.Missing != 1 {
		t.Fatalf("stats = %+v, %v", stats, err)
	}

	// The artwork cache must not be touched by a scan with no embedded art.
	if entries, err := os.ReadDir(cache.Dir()); err != nil || len(entries) != 0 {
		t.Fatalf("artwork entries = %d, %v", len(entries), err)
	}
}

func TestScannerIndexesVideoContainers(t *testing.T) {
	root := t.TempDir()
	writeM4A(t, filepath.Join(root, "Aaron Smith - Dancin.mp4"), 4)
	writeWebM(t, filepath.Join(root, "Kavinsky - Nightcall.webm"), 5)
	writeWebM(t, filepath.Join(root, "01 - First.mkv"), 6)

	scanner, st, _ := newTestScanner(t)
	folder, err := st.AddFolder(root)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if summary.Added != 3 || summary.Skipped != 0 {
		t.Fatalf("scan summary = %+v", summary)
	}

	page, err := st.ListTracks(store.TrackFilter{Sort: "title"})
	if err != nil || page.Total != 3 {
		t.Fatalf("tracks = %+v, %v", page, err)
	}
	byTitle := map[string]store.Track{}
	for _, track := range page.Tracks {
		byTitle[track.Title] = track
	}
	if got := byTitle["Dancin"]; got.Format != "mp4" || got.Artist != "Aaron Smith" || got.DurationMs != 4000 {
		t.Fatalf("mp4 track = %+v", got)
	}
	if got := byTitle["Nightcall"]; got.Format != "webm" || got.Artist != "Kavinsky" || got.DurationMs != 5000 {
		t.Fatalf("webm track = %+v", got)
	}
	if got := byTitle["First"]; got.Format != "mkv" || got.TrackNo != 1 || got.DurationMs != 6000 {
		t.Fatalf("mkv track = %+v", got)
	}
}

func TestScannerExtractsEmbeddedArtwork(t *testing.T) {
	root := t.TempDir()
	cover := testPNG(t, 300, 300)
	writeMP3WithID3v2(t, filepath.Join(root, "Tagged Artist - Tagged Song.mp3"),
		"Tagged Song", "Tagged Artist", "Tagged Album", cover)

	scanner, st, cache := newTestScanner(t)
	folder, _ := st.AddFolder(root)
	summary, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatal(err)
	}
	if summary.Added != 1 {
		t.Fatalf("summary = %+v", summary)
	}

	page, err := st.ListTracks(store.TrackFilter{})
	if err != nil || page.Total != 1 {
		t.Fatalf("tracks = %+v, %v", page, err)
	}
	track := page.Tracks[0]
	if track.Title != "Tagged Song" || track.Artist != "Tagged Artist" ||
		track.Album != "Tagged Album" || track.Genre != "Electronic" {
		t.Fatalf("tags not applied: %+v", track)
	}
	if track.Year != 2004 || track.TrackNo != 4 {
		t.Fatalf("year/track = %+v", track)
	}
	if track.ArtID == "" || track.Accent == "" {
		t.Fatalf("artwork not extracted: %+v", track)
	}
	if _, err := cache.Path(track.ArtID); err != nil {
		t.Fatalf("cached artwork missing: %v", err)
	}
	// MP3 duration comes from the Xing frame count.
	if track.DurationMs < 1000 {
		t.Fatalf("duration = %d", track.DurationMs)
	}
}

func TestScannerCancelLeavesMissingFlagsAlone(t *testing.T) {
	root := t.TempDir()
	writeWAV(t, filepath.Join(root, "one.wav"), 1)
	scanner, st, _ := newTestScanner(t)
	folder, _ := st.AddFolder(root)

	if _, err := scanner.Scan(context.Background(), folder); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	summary, err := scanner.Scan(ctx, folder)
	if err != nil {
		t.Fatal(err)
	}
	if !summary.Canceled {
		t.Fatalf("summary = %+v", summary)
	}
	stats, err := st.Stats()
	if err != nil {
		t.Fatal(err)
	}
	if stats.Tracks != 1 || stats.Missing != 0 {
		t.Fatalf("cancelled scan changed rows: %+v", stats)
	}
}

func TestScannerBrokenFileIsReportedNotFatal(t *testing.T) {
	root := t.TempDir()
	writeWAV(t, filepath.Join(root, "good.wav"), 1)
	bad := filepath.Join(root, "broken.mp3")
	if err := os.WriteFile(bad, []byte("broken"), 0o644); err != nil {
		t.Fatal(err)
	}

	scanner, st, _ := newTestScanner(t)
	folder, _ := st.AddFolder(root)
	summary, err := scanner.Scan(context.Background(), folder)
	if err != nil {
		t.Fatalf("scan aborted: %v", err)
	}
	// The MP3 has no readable tags or frames, but it is still imported with the
	// filename fallback; a bad file must not stop the rest of the scan.
	if summary.Added+summary.Updated != 2 {
		t.Fatalf("summary = %+v", summary)
	}
	page, err := st.ListTracks(store.TrackFilter{})
	if err != nil || page.Total != 2 {
		t.Fatalf("tracks = %+v, %v", page, err)
	}
}

func countPhase(progress []Progress, phase string) int {
	count := 0
	for _, p := range progress {
		if p.Phase == phase {
			count++
		}
	}
	return count
}
