package media

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"waven/internal/library"
	"waven/internal/store"
)

func writeTestWAV(t *testing.T, path string) {
	t.Helper()
	const dataSize = 16000
	buf := bytes.NewBuffer(nil)
	buf.WriteString("RIFF")
	buf.Write([]byte{0xa4, 0x3e, 0, 0})
	buf.WriteString("WAVEfmt ")
	buf.Write([]byte{16, 0, 0, 0, 1, 0, 1, 0})
	buf.Write([]byte{0x80, 0x3e, 0, 0}) // 16000 byte rate
	buf.Write([]byte{2, 0, 16, 0})      // block align, bits per sample
	buf.WriteString("data")
	buf.Write([]byte{0x80, 0x3e, 0, 0})
	buf.Write(make([]byte, dataSize))
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		t.Fatal(err)
	}
}

func testCover(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			img.Set(x, y, color.RGBA{R: uint8(x * 4), G: 80, B: uint8(y * 4), A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func newTestServer(t *testing.T) (*Server, *store.Store, int64, string, string) {
	t.Helper()
	root := t.TempDir()
	audioPath := filepath.Join(root, "song.wav")
	writeTestWAV(t, audioPath)

	st, err := store.Open(filepath.Join(t.TempDir(), "waven.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	folder, err := st.AddFolder(root)
	if err != nil {
		t.Fatal(err)
	}

	cache, err := library.NewArtworkCache(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	artID, accent, err := cache.Save(testCover(t))
	if err != nil {
		t.Fatal(err)
	}

	record := store.TrackRecord{
		FolderID: folder.ID, Path: audioPath, Title: "Song", Artist: "Artist",
		Album: "Album", AlbumArtist: "Artist", Format: "wav",
		SizeBytes: 44 + 16000, MTime: 1, ArtID: &artID, Accent: &accent,
		SearchText: "song artist album", LastSeenScan: 1,
	}
	if err := st.UpsertTracks([]store.TrackRecord{record}); err != nil {
		t.Fatal(err)
	}
	page, err := st.ListTracks(store.TrackFilter{})
	if err != nil || page.Total != 1 {
		t.Fatalf("tracks = %+v, %v", page, err)
	}

	srv, err := New(st, cache)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = srv.Close() })

	return srv, st, page.Tracks[0].ID, audioPath, artID
}

func TestServerServesAudioWithRange(t *testing.T) {
	srv, _, trackID, _, _ := newTestServer(t)

	res, err := http.Get(srv.TrackURL(trackID))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "audio/wav" {
		t.Fatalf("content-type = %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); cc != "no-store" {
		t.Fatalf("cache-control = %q", cc)
	}
	head := make([]byte, 4)
	if _, err := io.ReadFull(res.Body, head); err != nil {
		t.Fatal(err)
	}
	if string(head) != "RIFF" {
		t.Fatalf("body starts with %q", head)
	}

	req, _ := http.NewRequest(http.MethodGet, srv.TrackURL(trackID), nil)
	req.Header.Set("Range", "bytes=0-3")
	partial, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer partial.Body.Close()
	if partial.StatusCode != http.StatusPartialContent {
		t.Fatalf("range status = %d", partial.StatusCode)
	}
	if cr := partial.Header.Get("Content-Range"); !strings.HasPrefix(cr, "bytes 0-3/") {
		t.Fatalf("content-range = %q", cr)
	}

	headRes, err := http.Head(srv.TrackURL(trackID))
	if err != nil {
		t.Fatal(err)
	}
	headRes.Body.Close()
	if headRes.StatusCode != http.StatusOK {
		t.Fatalf("HEAD status = %d", headRes.StatusCode)
	}
}

func TestServerServesArtwork(t *testing.T) {
	srv, _, _, _, artID := newTestServer(t)

	res, err := http.Get(srv.ArtURL(artID))
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status = %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); ct != "image/jpeg" {
		t.Fatalf("content-type = %q", ct)
	}
	if cc := res.Header.Get("Cache-Control"); !strings.Contains(cc, "immutable") {
		t.Fatalf("cache-control = %q", cc)
	}
	data, err := io.ReadAll(res.Body)
	if err != nil || len(data) == 0 {
		t.Fatalf("artwork body = %d bytes, %v", len(data), err)
	}
}

func TestServerRejectsBadRequests(t *testing.T) {
	srv, st, trackID, audioPath, artID := newTestServer(t)

	tests := []struct {
		name string
		url  string
	}{
		{"bad token", strings.Replace(srv.TrackURL(trackID), "/m/", "/m/0000", 1)},
		{"missing track", srv.URL() + "/m/" + tokenOf(t, srv.TrackURL(trackID)) + "/9999"},
		{"bad art id", srv.URL() + "/a/" + tokenOf(t, srv.ArtURL(artID)) + "/not-a-hash"},
		{"art id traversal", srv.URL() + "/a/" + tokenOf(t, srv.ArtURL(artID)) + "/..%2f..%2fetc%2fpasswd"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res, err := http.Get(tt.url)
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != http.StatusNotFound {
				t.Fatalf("status = %d, want 404", res.StatusCode)
			}
		})
	}

	// A tampered database row pointing outside every root must not be served.
	outside := filepath.Join(t.TempDir(), "secret.wav")
	writeTestWAV(t, outside)
	folderID := int64(1)
	tampered := store.TrackRecord{
		FolderID: folderID, Path: outside, Title: "Secret", Format: "wav",
		SizeBytes: 1, MTime: 1, SearchText: "secret", LastSeenScan: 1,
	}
	if err := st.UpsertTracks([]store.TrackRecord{tampered}); err != nil {
		t.Fatal(err)
	}
	page, err := st.ListTracks(store.TrackFilter{Text: "secret"})
	if err != nil || page.Total != 1 {
		t.Fatalf("tampered track = %+v, %v", page, err)
	}
	res, err := http.Get(srv.TrackURL(page.Tracks[0].ID))
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("outside-root status = %d, want 404", res.StatusCode)
	}
	_ = audioPath
}

func tokenOf(t *testing.T, rawURL string) string {
	t.Helper()
	parts := strings.Split(rawURL, "/")
	if len(parts) < 4 {
		t.Fatalf("unexpected url %q", rawURL)
	}
	return parts[len(parts)-2]
}
