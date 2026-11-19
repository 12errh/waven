package library

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
)

const (
	artworkMaxEdge     = 512
	artworkJPEGQuality = 85
)

// ArtworkCache stores content-addressed JPEG covers. The database only keeps
// the SHA-256 ID and accent colour.
type ArtworkCache struct {
	dir string
}

// NewArtworkCache creates the cache directory if needed.
func NewArtworkCache(dir string) (*ArtworkCache, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("create artwork cache: %w", err)
	}
	return &ArtworkCache{dir: dir}, nil
}

// Dir returns the cache directory.
func (c *ArtworkCache) Dir() string { return c.dir }

// Save stores an embedded picture and returns its content hash and accent.
func (c *ArtworkCache) Save(data []byte) (string, string, error) {
	if len(data) == 0 {
		return "", "", errors.New("empty artwork")
	}
	sum := sha256.Sum256(data)
	id := hex.EncodeToString(sum[:])
	dst := filepath.Join(c.dir, id+".jpg")

	if _, err := os.Stat(dst); err == nil {
		accent, err := accentFromFile(dst)
		return id, accent, err
	}

	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return "", "", fmt.Errorf("decode artwork: %w", err)
	}

	bounds := src.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return "", "", errors.New("artwork has no pixels")
	}
	scale := 1.0
	if width > artworkMaxEdge || height > artworkMaxEdge {
		scale = float64(artworkMaxEdge) / float64(max(width, height))
	}
	outW := max(1, int(float64(width)*scale))
	outH := max(1, int(float64(height)*scale))
	resized := image.NewRGBA(image.Rect(0, 0, outW, outH))
	// Composite onto near-black so transparent covers do not turn white in
	// the JPEG conversion.
	draw.Draw(resized, resized.Bounds(), &image.Uniform{C: color.RGBA{17, 18, 23, 255}}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(resized, resized.Bounds(), src, bounds, draw.Over, nil)

	tmp, err := os.CreateTemp(c.dir, ".art-*.jpg")
	if err != nil {
		return "", "", fmt.Errorf("create artwork file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if err := jpeg.Encode(tmp, resized, &jpeg.Options{Quality: artworkJPEGQuality}); err != nil {
		tmp.Close()
		return "", "", fmt.Errorf("encode artwork: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", "", err
	}
	if err := os.Rename(tmpName, dst); err != nil {
		return "", "", fmt.Errorf("install artwork: %w", err)
	}
	return id, accentColor(resized), nil
}

func accentFromFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	img, _, err := image.Decode(f)
	if err != nil {
		return "", err
	}
	return accentColor(img), nil
}

// accentColor samples an 8x8 version of the cover and returns a usable
// dominant colour. Saturated pixels are weighted more heavily so a cover with a
// vivid subject on a grey background produces the vivid colour.
func accentColor(img image.Image) string {
	const sample = 8
	small := image.NewRGBA(image.Rect(0, 0, sample, sample))
	draw.ApproxBiLinear.Scale(small, small.Bounds(), img, img.Bounds(), draw.Src, nil)

	var sr, sg, sb, weight float64
	var ar, ag, ab float64
	for y := 0; y < sample; y++ {
		for x := 0; x < sample; x++ {
			r, g, b, _ := small.At(x, y).RGBA()
			rf, gf, bf := float64(r>>8), float64(g>>8), float64(b>>8)
			ar += rf
			ag += gf
			ab += bf
			hi := max(rf, gf, bf)
			lo := min(rf, gf, bf)
			w := 1 + (hi-lo)/255*3
			sr += rf * w
			sg += gf * w
			sb += bf * w
			weight += w
		}
	}
	rf, gf, bf := sr/weight, sg/weight, sb/weight
	if weight == 0 {
		rf, gf, bf = ar/64, ag/64, ab/64
	}
	// Keep the accent legible on the dark shell.
	luma := 0.2126*rf + 0.7152*gf + 0.0722*bf
	if luma < 55 {
		rf = rf*0.55 + 40
		gf = gf*0.55 + 44
		bf = bf*0.55 + 54
	} else if luma > 205 {
		rf *= 0.82
		gf *= 0.82
		bf *= 0.82
	}
	return fmt.Sprintf("#%02x%02x%02x", clampByte(rf), clampByte(gf), clampByte(bf))
}

func clampByte(v float64) int {
	if v < 0 {
		return 0
	}
	if v > 255 {
		return 255
	}
	return int(v + 0.5)
}

// Path returns the cached JPEG path for a validated art ID.
func (c *ArtworkCache) Path(id string) (string, error) {
	if !validArtID(id) {
		return "", errors.New("invalid artwork id")
	}
	path := filepath.Join(c.dir, id+".jpg")
	if _, err := os.Stat(path); err != nil {
		return "", err
	}
	return filepath.Clean(path), nil
}

// Size returns the total bytes used by cached covers.
func (c *ArtworkCache) Size() int64 {
	var total int64
	entries, err := os.ReadDir(c.dir)
	if err != nil {
		return 0
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jpg") {
			continue
		}
		info, err := entry.Info()
		if err == nil {
			total += info.Size()
		}
	}
	return total
}

func validArtID(id string) bool {
	if len(id) != sha256.Size*2 {
		return false
	}
	for _, r := range id {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}
