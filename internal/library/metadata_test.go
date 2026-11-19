package library

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestMetadataFromFilename(t *testing.T) {
	tests := []struct {
		name       string
		file       string
		wantTitle  string
		wantArtist string
		wantTrack  int
	}{
		{"artist and title", "Daft Punk - Aerodynamic.flac", "Aerodynamic", "Daft Punk", 0},
		{"track number", "07 - Nightcall.mp3", "Nightcall", "", 7},
		{"track and artist", "03 - Artist Name - Song Title.ogg", "Artist Name - Song Title", "", 3},
		{"bare filename", "Untitled Demo.wav", "Untitled Demo", "", 0},
		{"dotted name", "M83 - Outro (Live).m4a", "Outro (Live)", "M83", 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			meta := metadataFromFilename(tt.file)
			if meta.Title != tt.wantTitle {
				t.Errorf("Title = %q, want %q", meta.Title, tt.wantTitle)
			}
			if meta.Artist != tt.wantArtist {
				t.Errorf("Artist = %q, want %q", meta.Artist, tt.wantArtist)
			}
			if meta.TrackNo != tt.wantTrack {
				t.Errorf("TrackNo = %d, want %d", meta.TrackNo, tt.wantTrack)
			}
		})
	}
}

func TestNormalize(t *testing.T) {
	if got := Normalize("  Björk – Jóga  "); got != "bjork – joga" {
		t.Fatalf("Normalize = %q", got)
	}
}

func TestCleanTagStripsBOM(t *testing.T) {
	if got := cleanTag("\ufeffSherine - Topic "); got != "Sherine - Topic" {
		t.Fatalf("cleanTag = %q, want BOM and padding removed", got)
	}
	if got := metadataFromFilename("\ufeff01 - Nightcall.mp3").Title; got != "Nightcall" {
		t.Fatalf("filename title = %q", got)
	}
}

func TestReadMetadataID3v1(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "tagged.mp3")
	writeMP3(t, path, 10)

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	tag := make([]byte, 128)
	copy(tag[0:3], "TAG")
	copy(tag[3:33], "Test Title")
	copy(tag[33:63], "Test Artist")
	copy(tag[63:93], "Test Album")
	copy(tag[93:97], "1999")
	copy(tag[97:127], "A comment")
	tag[127] = 13 // Pop
	if err := os.WriteFile(path, append(data, tag...), 0o644); err != nil {
		t.Fatal(err)
	}

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Fatalf("ReadMetadata: %v", err)
	}
	if meta.Title != "Test Title" || meta.Artist != "Test Artist" || meta.Album != "Test Album" {
		t.Fatalf("unexpected metadata: %+v", meta)
	}
	if meta.Year != 1999 || meta.Genre != "Pop" {
		t.Fatalf("unexpected year/genre: %+v", meta)
	}
	if meta.AlbumArtist != "Test Artist" {
		t.Fatalf("AlbumArtist = %q, want artist fallback", meta.AlbumArtist)
	}
	if meta.DiscNo != 1 {
		t.Fatalf("DiscNo = %d, want 1", meta.DiscNo)
	}
}

func TestReadMetadataNoTags(t *testing.T) {
	path := filepath.Join(t.TempDir(), "01 - Fallback.wav")
	writeWAV(t, path, 1)

	meta, err := ReadMetadata(path)
	if err != nil {
		t.Logf("ReadMetadata warning: %v", err)
	}
	if meta.Title != "Fallback" || meta.TrackNo != 1 {
		t.Fatalf("unexpected fallback metadata: %+v", meta)
	}
}

// TestReadMetadataBrokenFile ensures the filename fallback survives a bad tag
// block instead of dropping the file from the library.
func TestReadMetadataBrokenFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Broken - But Usable.mp3")
	data := bytes.Repeat([]byte{0xff}, 64)
	data[0], data[1], data[2] = 'I', 'D', '3' // truncated ID3 header
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}

	meta, err := ReadMetadata(path)
	if err == nil {
		t.Fatal("expected a tag error")
	}
	if meta.Title != "But Usable" || meta.Artist != "Broken" {
		t.Fatalf("fallback not applied: %+v", meta)
	}
}
