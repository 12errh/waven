package library

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testPNG(t *testing.T, width, height int) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			img.SetNRGBA(x, y, color.NRGBA{
				R: uint8(40 + 200*x/width),
				G: uint8(30 + 120*y/height),
				B: 90,
				A: 255,
			})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("encode png: %v", err)
	}
	return buf.Bytes()
}

func TestArtworkCacheResizeAndAccent(t *testing.T) {
	dir := t.TempDir()
	cache, err := NewArtworkCache(dir)
	if err != nil {
		t.Fatal(err)
	}

	id, accent, err := cache.Save(testPNG(t, 1024, 512))
	if err != nil {
		t.Fatalf("Save: %v", err)
	}
	if len(id) != 64 {
		t.Fatalf("art id length = %d, want 64", len(id))
	}
	if !strings.HasPrefix(accent, "#") || len(accent) != 7 {
		t.Fatalf("accent = %q, want #rrggbb", accent)
	}

	path, err := cache.Path(id)
	if err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := jpeg.Decode(f)
	if err != nil {
		t.Fatalf("decode cached jpeg: %v", err)
	}
	if got := img.Bounds().Dx(); got != 512 {
		t.Fatalf("cached width = %d, want 512", got)
	}
	if got := img.Bounds().Dy(); got != 256 {
		t.Fatalf("cached height = %d, want 256", got)
	}

	// Saving identical bytes is content-addressed and must not duplicate work.
	id2, _, err := cache.Save(testPNG(t, 1024, 512))
	if err != nil {
		t.Fatal(err)
	}
	if id2 != id {
		t.Fatalf("second Save id = %q, want %q", id2, id)
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 {
		t.Fatalf("cache entries = %d, want 1", len(entries))
	}
	if cache.Size() <= 0 {
		t.Fatal("cache Size returned zero")
	}
}

func TestArtworkCacheRejectsBadIDs(t *testing.T) {
	cache, err := NewArtworkCache(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"", "short", "../../etc/passwd", strings.Repeat("G", 64)} {
		if _, err := cache.Path(id); err == nil {
			t.Fatalf("Path(%q) accepted an invalid id", id)
		}
	}
}

func TestArtworkCacheRejectsGarbage(t *testing.T) {
	cache, err := NewArtworkCache(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := cache.Save([]byte("definitely not an image")); err == nil {
		t.Fatal("expected decode error")
	}
	if _, _, err := cache.Save(nil); err == nil {
		t.Fatal("expected empty-artwork error")
	}
}

func TestArtworkCacheSmallImageKeepsSize(t *testing.T) {
	cache, err := NewArtworkCache(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, _, err := cache.Save(testPNG(t, 64, 32))
	if err != nil {
		t.Fatal(err)
	}
	path, err := cache.Path(id)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Size() == 0 {
		t.Fatal("empty cache file")
	}
	if _, err := os.Stat(filepath.Join(cache.Dir(), id+".jpg")); err != nil {
		t.Fatal(err)
	}
}
