package library

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dhowden/tag"

	"waven/internal/store"
)

// Supported audio extensions. Video containers such as .mp4 are deliberately
// excluded.
var supportedExtensions = map[string]string{
	".mp3":  "mp3",
	".m4a":  "m4a",
	".aac":  "aac",
	".flac": "flac",
	".wav":  "wav",
	".aiff": "aiff",
	".aif":  "aiff",
	".ogg":  "ogg",
	".oga":  "ogg",
	".opus": "opus",
}

var junkDirectories = map[string]bool{
	"node_modules":              true,
	"#recycle":                  true,
	"@eadir":                    true,
	"$recycle.bin":              true,
	"system volume information": true,
	"lost+found":                true,
	".git":                      true,
	".trash":                    true,
	".trashes":                  true,
}

const (
	phaseDiscovering = "discovering"
	phaseScanning    = "scanning"
	phaseFinalizing  = "finalizing"
	phaseDone        = "done"
)

// Progress is emitted while a scan runs.
type Progress struct {
	Phase       string `json:"phase"`
	Done        int    `json:"done"`
	Total       int    `json:"total"`
	CurrentPath string `json:"currentPath"`
	FolderID    int64  `json:"folderId"`
	FolderPath  string `json:"folderPath"`
}

// ScanIssue records a non-fatal file problem.
type ScanIssue struct {
	Path    string `json:"path"`
	Message string `json:"message"`
}

// ScanSummary is the result of one root scan.
type ScanSummary struct {
	FolderID   int64       `json:"folderId"`
	FolderPath string      `json:"folderPath"`
	Added      int         `json:"added"`
	Updated    int         `json:"updated"`
	Removed    int         `json:"removed"`
	Missing    int         `json:"missing"`
	Skipped    int         `json:"skipped"`
	Errors     []ScanIssue `json:"errors"`
	Canceled   bool        `json:"canceled"`
	StartedAt  int64       `json:"startedAt"`
	FinishedAt int64       `json:"finishedAt"`
}

type candidate struct {
	path  string
	size  int64
	mtime int64
}

type parseResult struct {
	path    string
	skipped bool
	err     error
	record  store.TrackRecord
}

// Scanner walks roots and writes parsed tracks into the store.
type Scanner struct {
	Store    *store.Store
	Artwork  *ArtworkCache
	Workers  int
	Progress func(Progress)
}

// Scan scans one registered root. A cancelled scan leaves the existing missing
// flags alone, because the walk may not have reached every file.
func (s *Scanner) Scan(ctx context.Context, folder store.Folder) (ScanSummary, error) {
	summary := ScanSummary{
		FolderID:   folder.ID,
		FolderPath: folder.Path,
		StartedAt:  nowMillis(),
		Errors:     make([]ScanIssue, 0),
	}
	scanTime := summary.StartedAt

	files, err := s.collect(ctx, folder)
	if err != nil {
		return summary, err
	}
	summary.FinishedAt = nowMillis()
	if err := ctx.Err(); err != nil {
		summary.Canceled = true
		return summary, nil
	}
	if len(files) == 0 {
		summary.FinishedAt = nowMillis()
		if err := s.finish(folder, scanTime, &summary); err != nil {
			return summary, err
		}
		return summary, nil
	}

	states, err := s.Store.FileStates(folder.ID)
	if err != nil {
		return summary, fmt.Errorf("read file states: %w", err)
	}

	s.emit(Progress{Phase: phaseScanning, Total: len(files), FolderID: folder.ID, FolderPath: folder.Path})
	results := s.parseAll(ctx, files, states, scanTime)

	records := make([]store.TrackRecord, 0, 200)
	touches := make([]string, 0, 500)
	done := 0
	flushRecords := func() error {
		if len(records) == 0 {
			return nil
		}
		if err := s.Store.UpsertTracks(records); err != nil {
			return err
		}
		records = records[:0]
		return nil
	}
	flushTouches := func() error {
		if len(touches) == 0 {
			return nil
		}
		if err := s.Store.TouchTracks(folder.ID, scanTime, touches); err != nil {
			return err
		}
		touches = touches[:0]
		return nil
	}

	for res := range results {
		done++
		if res.err != nil {
			s.addIssue(&summary, res.path, res.err)
			s.emit(Progress{Phase: phaseScanning, Done: done, Total: len(files), CurrentPath: res.path, FolderID: folder.ID, FolderPath: folder.Path})
			continue
		}
		if res.skipped {
			summary.Skipped++
			touches = append(touches, res.path)
			if len(touches) >= 500 {
				if err := flushTouches(); err != nil {
					return summary, err
				}
			}
		} else {
			if _, existed := states[res.path]; existed {
				summary.Updated++
			} else {
				summary.Added++
			}
			res.record.FolderID = folder.ID
			records = append(records, res.record)
			if len(records) >= 200 {
				if err := flushRecords(); err != nil {
					return summary, err
				}
			}
		}
		s.emit(Progress{Phase: phaseScanning, Done: done, Total: len(files), CurrentPath: res.path, FolderID: folder.ID, FolderPath: folder.Path})
	}

	if err := flushRecords(); err != nil {
		return summary, err
	}
	if err := flushTouches(); err != nil {
		return summary, err
	}

	summary.FinishedAt = nowMillis()
	if ctx.Err() != nil {
		summary.Canceled = true
		return summary, nil
	}
	if err := s.finish(folder, scanTime, &summary); err != nil {
		return summary, err
	}
	return summary, nil
}

func (s *Scanner) finish(folder store.Folder, scanTime int64, summary *ScanSummary) error {
	removed, err := s.Store.MarkMissing(folder.ID, scanTime)
	if err != nil {
		return fmt.Errorf("mark missing tracks: %w", err)
	}
	summary.Removed = removed
	missing, err := s.Store.MissingCount(folder.ID)
	if err != nil {
		return err
	}
	summary.Missing = missing
	if err := s.Store.SetFolderLastScan(folder.ID, summary.FinishedAt); err != nil {
		return err
	}
	_ = s.Store.SetSetting("library.lastScanAt", strconv.FormatInt(summary.FinishedAt, 10))
	s.emit(Progress{
		Phase:      phaseDone,
		Done:       summary.Added + summary.Updated + summary.Skipped,
		Total:      summary.Added + summary.Updated + summary.Skipped,
		FolderID:   folder.ID,
		FolderPath: folder.Path,
	})
	return nil
}

func (s *Scanner) collect(ctx context.Context, folder store.Folder) ([]candidate, error) {
	files := make([]candidate, 0, 1024)
	err := filepath.WalkDir(folder.Path, func(path string, d fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			s.emit(Progress{Phase: phaseDiscovering, CurrentPath: path, FolderID: folder.ID, FolderPath: folder.Path})
			if errors.Is(walkErr, fs.ErrPermission) {
				return nil
			}
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if path == folder.Path {
			return nil
		}
		name := d.Name()
		if d.IsDir() {
			if shouldSkipDir(name) {
				return filepath.SkipDir
			}
			return nil
		}
		if d.Type()&os.ModeSymlink != 0 {
			return nil
		}
		if strings.HasPrefix(name, ".") {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(name))
		if _, ok := supportedExtensions[ext]; !ok {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		files = append(files, candidate{path: path, size: info.Size(), mtime: info.ModTime().UnixMilli()})
		s.emit(Progress{Phase: phaseDiscovering, Done: len(files), Total: len(files), CurrentPath: path, FolderID: folder.ID, FolderPath: folder.Path})
		return nil
	})
	if err != nil && !errors.Is(err, context.Canceled) {
		return nil, err
	}
	sort.Slice(files, func(i, j int) bool { return files[i].path < files[j].path })
	return files, nil
}

func shouldSkipDir(name string) bool {
	if strings.HasPrefix(name, ".") {
		return true
	}
	return junkDirectories[strings.ToLower(name)]
}

func (s *Scanner) parseAll(ctx context.Context, files []candidate, states map[string]store.FileState, scanTime int64) <-chan parseResult {
	workers := s.Workers
	if workers <= 0 {
		workers = min(runtime.NumCPU(), 8)
	}
	if workers < 1 {
		workers = 1
	}

	jobs := make(chan candidate, workers*2)
	results := make(chan parseResult, workers*2)
	var wg sync.WaitGroup
	wg.Add(workers)
	for i := 0; i < workers; i++ {
		go func() {
			defer wg.Done()
			for file := range jobs {
				if ctx.Err() != nil {
					return
				}
				if state, ok := states[file.path]; ok && !state.Missing && state.SizeBytes == file.size && state.MTime == file.mtime {
					results <- parseResult{path: file.path, skipped: true}
					continue
				}
				record, err := s.parseFile(ctx, file, scanTime)
				results <- parseResult{path: file.path, record: record, err: err}
			}
		}()
	}
	go func() {
		defer close(jobs)
		for _, file := range files {
			select {
			case <-ctx.Done():
				return
			case jobs <- file:
			}
		}
	}()
	go func() {
		wg.Wait()
		close(results)
	}()
	return results
}

func (s *Scanner) parseFile(ctx context.Context, file candidate, scanTime int64) (store.TrackRecord, error) {
	if err := ctx.Err(); err != nil {
		return store.TrackRecord{}, err
	}
	meta, tagErr := ReadMetadata(file.path)
	if tagErr != nil && !errors.Is(tagErr, tag.ErrNoTagsFound) {
		// A broken tag block is a warning, not a reason to drop the file. The
		// filename fallback still gives a usable title and artist.
		meta = metadataFromFilename(file.path)
	}
	durationMs := DurationMs(file.path)
	if durationMs < 0 {
		durationMs = 0
	}

	format := supportedExtensions[strings.ToLower(filepath.Ext(file.path))]
	record := store.TrackRecord{
		Path:         file.path,
		Title:        fallback(meta.Title, "Unknown Title"),
		Artist:       meta.Artist,
		Album:        meta.Album,
		AlbumArtist:  meta.AlbumArtist,
		Genre:        meta.Genre,
		DurationMs:   durationMs,
		Format:       format,
		SizeBytes:    file.size,
		MTime:        file.mtime,
		LastSeenScan: scanTime,
		SearchText:   SearchText(meta.Title, meta.Artist, meta.Album, meta.AlbumArtist, meta.Genre),
	}
	if meta.Year > 0 {
		v := meta.Year
		record.Year = &v
	}
	if meta.TrackNo > 0 {
		v := meta.TrackNo
		record.TrackNo = &v
	}
	if meta.DiscNo > 0 {
		v := meta.DiscNo
		record.DiscNo = &v
	}
	if record.AlbumArtist == "" {
		record.AlbumArtist = record.Artist
	}
	if record.DiscNo == nil {
		v := 1
		record.DiscNo = &v
	}

	if meta.Picture != nil && s.Artwork != nil {
		id, accent, err := s.Artwork.Save(meta.Picture.Data)
		if err == nil {
			record.ArtID = &id
			if accent != "" {
				record.Accent = &accent
			}
		}
	}
	return record, nil
}

func (s *Scanner) emit(p Progress) {
	if s.Progress != nil {
		s.Progress(p)
	}
}

func (s *Scanner) addIssue(summary *ScanSummary, path string, err error) {
	const maxIssues = 50
	if len(summary.Errors) >= maxIssues {
		return
	}
	summary.Errors = append(summary.Errors, ScanIssue{Path: path, Message: err.Error()})
}

func fallback(v, def string) string {
	if strings.TrimSpace(v) == "" {
		return def
	}
	return v
}

func nowMillis() int64 {
	return time.Now().UnixMilli()
}
