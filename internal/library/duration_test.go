package library

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDurationParsers(t *testing.T) {
	dir := t.TempDir()

	tests := []struct {
		name      string
		file      string
		write     func(*testing.T, string, int)
		seconds   int
		totalMs   int64
		tolerance int64
	}{
		{"wav", "sample.wav", writeWAV, 2, 2000, 5},
		{"flac", "sample.flac", writeFLAC, 3, 3000, 5},
		{"aiff", "sample.aiff", writeAIFF, 4, 4000, 5},
		{"m4a", "sample.m4a", writeM4A, 5, 5000, 1},
		{"mp4", "sample.mp4", writeM4A, 5, 5000, 1},
		{"m4v", "sample.m4v", writeM4A, 5, 5000, 1},
		{"webm", "sample.webm", writeWebM, 6, 6000, 1},
		{"mkv", "sample.mkv", writeWebM, 7, 7000, 1},
		{"opus", "sample.opus", writeOpusOgg, 6, 6000, 1},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(dir, tt.file)
			tt.write(t, path, tt.seconds)
			got := DurationMs(path)
			if diff := got - tt.totalMs; diff < -tt.tolerance || diff > tt.tolerance {
				t.Fatalf("DurationMs(%s) = %d, want %d ± %d", tt.file, got, tt.totalMs, tt.tolerance)
			}
		})
	}
}

func TestMP3Duration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.mp3")
	writeMP3(t, path, 100)

	// 100 frames × 1152 samples / 44100 Hz.
	const want = int64(100 * 1152 * 1000 / 44100)
	if got := DurationMs(path); got != want {
		t.Fatalf("DurationMs(mp3) = %d, want %d", got, want)
	}
}

func TestADTSDuration(t *testing.T) {
	path := filepath.Join(t.TempDir(), "sample.aac")
	writeADTS(t, path, 200)

	const want = int64(200 * 1024 * 1000 / 44100)
	if got := DurationMs(path); got != want {
		t.Fatalf("DurationMs(aac) = %d, want %d", got, want)
	}
}

func TestMatroskaDurationUnknownSegmentSize(t *testing.T) {
	path := filepath.Join(t.TempDir(), "stream.webm")
	writeWebM(t, path, 9)

	// Streamed WebM leaves the segment size as the one-byte unknown value.
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) < 10 {
		t.Fatalf("fixture too short: %d bytes", len(data))
	}
	data[9] = 0xff
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := DurationMs(path); got != 9000 {
		t.Fatalf("DurationMs(webm, unknown segment) = %d, want 9000", got)
	}
}

func TestDurationRejectsGarbage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "broken.flac")
	if err := writeBytes(path, []byte("not audio at all")); err != nil {
		t.Fatal(err)
	}
	if got := DurationMs(path); got != 0 {
		t.Fatalf("DurationMs(garbage) = %d, want 0", got)
	}
}

func TestDurationMissingFile(t *testing.T) {
	if got := DurationMs(filepath.Join(t.TempDir(), "absent.mp3")); got != 0 {
		t.Fatalf("DurationMs(absent) = %d, want 0", got)
	}
}
