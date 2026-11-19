package library

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"unicode"

	"github.com/dhowden/tag"
	"golang.org/x/text/unicode/norm"
)

// Metadata is the tag information used to build a library row.
type Metadata struct {
	Title       string
	Artist      string
	Album       string
	AlbumArtist string
	Genre       string
	Year        int
	TrackNo     int
	DiscNo      int
	Picture     *Picture
}

// Picture is embedded cover art copied out of the tag reader.
type Picture struct {
	Data     []byte
	MIMEType string
}

// ReadMetadata reads tags from a supported file. A tag error is returned
// alongside filename-derived fallbacks so the scanner can still import the
// track and report a non-fatal warning.
func ReadMetadata(path string) (Metadata, error) {
	meta := metadataFromFilename(path)
	f, err := os.Open(path)
	if err != nil {
		return meta, err
	}
	defer f.Close()

	tags, err := tag.ReadFrom(f)
	if err != nil {
		return meta, err
	}

	if v := cleanTag(tags.Title()); v != "" {
		meta.Title = v
	}
	if v := cleanTag(tags.Artist()); v != "" {
		meta.Artist = v
	}
	if v := cleanTag(tags.Album()); v != "" {
		meta.Album = v
	}
	if v := cleanTag(tags.AlbumArtist()); v != "" {
		meta.AlbumArtist = v
	}
	if v := cleanTag(tags.Genre()); v != "" {
		meta.Genre = v
	}
	if v := tags.Year(); v > 0 {
		meta.Year = v
	}
	if n, _ := tags.Track(); n > 0 {
		meta.TrackNo = n
	}
	if n, _ := tags.Disc(); n > 0 {
		meta.DiscNo = n
	}
	if pic := tags.Picture(); pic != nil && len(pic.Data) > 0 {
		meta.Picture = &Picture{Data: pic.Data, MIMEType: pic.MIMEType}
	}

	if meta.AlbumArtist == "" {
		meta.AlbumArtist = meta.Artist
	}
	if meta.DiscNo == 0 {
		meta.DiscNo = 1
	}
	return meta, nil
}

// metadataFromFilename implements the fallback rules: "Artist - Title",
// "NN - Title", then the bare filename.
func metadataFromFilename(path string) Metadata {
	base := filepath.Base(path)
	base = strings.TrimSuffix(base, filepath.Ext(base))
	base = strings.TrimSpace(stripBOM(base))
	// yt-dlp sometimes leaves the chosen format ID as a second extension
	// ("Song.f251.webm"). It is not part of the title.
	base = dropFormatIDSuffix(base)

	meta := Metadata{Title: base, DiscNo: 1}
	if idx := strings.Index(base, " - "); idx > 0 {
		left := strings.TrimSpace(base[:idx])
		right := strings.TrimSpace(base[idx+3:])
		if left != "" && right != "" {
			meta.Title = right
			if n, ok := numericPrefix(left); ok {
				meta.TrackNo = n
			} else {
				meta.Artist = left
			}
			return meta
		}
	}
	if n, rest, ok := splitLeadingTrackNumber(base); ok {
		meta.TrackNo = n
		if rest != "" {
			meta.Title = rest
		}
	}
	return meta
}

// dropFormatIDSuffix removes a trailing yt-dlp format selector such as
// ".f251" so the filename fallback does not leak it into the title.
func dropFormatIDSuffix(base string) string {
	dot := strings.LastIndexByte(base, '.')
	if dot <= 0 || dot == len(base)-1 {
		return base
	}
	suffix := base[dot+1:]
	if len(suffix) < 2 || len(suffix) > 4 || suffix[0] != 'f' {
		return base
	}
	for _, r := range suffix[1:] {
		if r < '0' || r > '9' {
			return base
		}
	}
	return strings.TrimSpace(base[:dot])
}

func numericPrefix(s string) (int, bool) {
	s = strings.TrimSpace(s)
	if len(s) < 1 || len(s) > 3 {
		return 0, false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0, false
		}
	}
	n, err := strconv.Atoi(s)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}

func splitLeadingTrackNumber(s string) (int, string, bool) {
	s = strings.TrimSpace(s)
	i := 0
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == 0 || i > 3 {
		return 0, s, false
	}
	rest := strings.TrimSpace(s[i:])
	if rest == "" {
		return 0, s, false
	}
	if rest[0] != '-' && rest[0] != '.' && rest[0] != '_' {
		return 0, s, false
	}
	rest = strings.TrimSpace(rest[1:])
	if rest == "" {
		return 0, s, false
	}
	n, err := strconv.Atoi(s[:i])
	if err != nil {
		return 0, s, false
	}
	return n, rest, true
}

func cleanTag(v string) string {
	v = strings.TrimSpace(stripBOM(v))
	v = strings.ReplaceAll(v, "\x00", "")
	return strings.TrimSpace(v)
}

// stripBOM removes a leading UTF-8 byte-order mark. Some real-world taggers
// write one into MP3 text frames; left in place it renders as an invisible
// character and breaks search prefixes.
func stripBOM(v string) string {
	return strings.TrimPrefix(v, "\ufeff")
}

// Normalize returns the lowercase, accent-folded form used for search_text and
// query matching.
func Normalize(s string) string {
	s = norm.NFD.String(strings.ToLower(strings.TrimSpace(s)))
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// SearchText combines the fields that participate in search.
func SearchText(title, artist, album, albumArtist, genre string) string {
	return Normalize(strings.Join([]string{title, artist, album, albumArtist, genre}, " "))
}

// NormalizePath returns a cleaned absolute path for stable comparisons.
func NormalizePath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", fmt.Errorf("resolve path: %w", err)
	}
	return filepath.Clean(abs), nil
}
