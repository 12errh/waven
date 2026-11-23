package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// playerSessionKey is the settings row that holds the resumable player queue.
const playerSessionKey = "player.session"

// PlayerSession is the resumable playback state. The frontend owns the audio
// element; Go only stores the queue so a relaunch can restore it paused.
type PlayerSession struct {
	TrackID      int64   `json:"trackId"`
	PositionMs   int64   `json:"positionMs"`
	QueueIDs     []int64 `json:"queueIds"`
	QueueIndex   int     `json:"queueIndex"`
	Shuffle      bool    `json:"shuffle"`
	ShuffleOrder []int64 `json:"shuffleOrder"`
	Repeat       string  `json:"repeat"`
	Volume       float64 `json:"volume"`
	Muted        bool    `json:"muted"`
	UpdatedAt    int64   `json:"updatedAt"`
}

// PlayerState is the live now-playing snapshot used for tray labels and the
// compact window. It is not persisted; the resumable state is PlayerSession.
type PlayerState struct {
	TrackID    int64  `json:"trackId"`
	Title      string `json:"title"`
	Artist     string `json:"artist"`
	Album      string `json:"album"`
	CoverSrc   string `json:"coverSrc"`
	Liked      bool   `json:"liked"`
	Playing    bool   `json:"playing"`
	PositionMs int64  `json:"positionMs"`
	DurationMs int64  `json:"durationMs"`
}

// PlayerService owns session persistence, play history, and tray state. It
// shares the library's SQLite handle so playback writes never open a second
// database connection.
type PlayerService struct {
	app     *application.App
	library *LibraryService
	shell   *Desktop

	mu          sync.Mutex
	state       PlayerState
	lastSession PlayerSession
	haveSession bool
}

// NewPlayerService wires the player to the library store and optional desktop
// shell. app may be nil in tests.
func NewPlayerService(app *application.App, library *LibraryService, shell *Desktop) (*PlayerService, error) {
	if library == nil || library.store == nil {
		return nil, errors.New("player: library store is required")
	}
	return &PlayerService{app: app, library: library, shell: shell}, nil
}

// ServiceName makes generated bindings call this service "Player".
func (s *PlayerService) ServiceName() string { return "Player" }

// ServiceShutdown flushes the last reported position into the session. Wails
// shuts services down in reverse registration order, so the Player runs before
// the Library closes the shared database handle.
func (s *PlayerService) ServiceShutdown() error {
	s.mu.Lock()
	session := s.lastSession
	state := s.state
	haveSession := s.haveSession
	s.mu.Unlock()
	if !haveSession {
		return nil
	}
	if state.TrackID > 0 && containsID(session.QueueIDs, state.TrackID) {
		session.TrackID = state.TrackID
		if index := indexOfID(session.QueueIDs, state.TrackID); index >= 0 {
			session.QueueIndex = index
		}
		if state.PositionMs >= 0 {
			session.PositionMs = state.PositionMs
		}
	}
	session.UpdatedAt = time.Now().UnixMilli()
	return s.writeSession(session)
}

// GetSession returns the stored queue, pruned to tracks that still exist. A
// missing current track falls forward to the next available queue entry.
func (s *PlayerService) GetSession() (PlayerSession, error) {
	session := defaultSession()
	raw, ok, err := s.library.store.Setting(playerSessionKey)
	if err != nil {
		return PlayerSession{}, err
	}
	if ok {
		if err := json.Unmarshal([]byte(raw), &session); err != nil {
			// A corrupt session must never prevent the app from starting.
			return defaultSession(), nil
		}
	}
	return s.pruneSession(session)
}

// SaveSession persists the queue and playback position. Called every five
// seconds while playing and on pause, track change, hide, and quit.
func (s *PlayerService) SaveSession(session PlayerSession) error {
	session = normalizeSession(session)
	session.UpdatedAt = time.Now().UnixMilli()
	if err := s.writeSession(session); err != nil {
		return err
	}
	s.mu.Lock()
	s.lastSession = session
	s.haveSession = true
	s.mu.Unlock()
	return nil
}

func (s *PlayerService) writeSession(session PlayerSession) error {
	encoded, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("encode player session: %w", err)
	}
	return s.library.store.SetSetting(playerSessionKey, string(encoded))
}

// RecordPlay appends a completed listen. positionMs is the position reached
// when the track crossed the 30-second or 50% threshold.
func (s *PlayerService) RecordPlay(trackID, positionMs int64) error {
	if trackID <= 0 {
		return errors.New("a track is required")
	}
	if _, err := s.library.store.GetTrack(trackID); err != nil {
		return fmt.Errorf("record play: %w", err)
	}
	return s.library.store.RecordPlay(trackID, time.Now().UnixMilli(), positionMs)
}

// UpdateState mirrors the live player state into the tray and the compact
// window. The frontend calls this on track and play/pause changes, and
// periodically while playing.
func (s *PlayerService) UpdateState(state PlayerState) error {
	s.mu.Lock()
	s.state = state
	shell := s.shell
	app := s.app
	s.mu.Unlock()
	if shell != nil {
		shell.SetNowPlaying(state)
	}
	if app != nil {
		app.Event.Emit("player:state", state)
	}
	return nil
}

// GetState returns the last state reported by the frontend. It is used by
// diagnostics and tests.
func (s *PlayerService) GetState() PlayerState {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.state
}

func defaultSession() PlayerSession {
	return PlayerSession{
		QueueIDs:     []int64{},
		ShuffleOrder: []int64{},
		Repeat:       "off",
		Volume:       0.8,
	}
}

func normalizeSession(session PlayerSession) PlayerSession {
	if session.QueueIDs == nil {
		session.QueueIDs = []int64{}
	}
	if session.ShuffleOrder == nil {
		session.ShuffleOrder = []int64{}
	}
	switch session.Repeat {
	case "all", "one":
	default:
		session.Repeat = "off"
	}
	if session.Volume < 0 {
		session.Volume = 0
	}
	if session.Volume > 1 {
		session.Volume = 1
	}
	if session.PositionMs < 0 {
		session.PositionMs = 0
	}
	if session.QueueIndex < 0 {
		session.QueueIndex = 0
	}
	session.QueueIDs = dedupeIDs(session.QueueIDs)
	if len(session.QueueIDs) == 0 {
		session.QueueIndex = 0
	} else if session.QueueIndex >= len(session.QueueIDs) {
		session.QueueIndex = len(session.QueueIDs) - 1
	}
	return session
}

func dedupeIDs(ids []int64) []int64 {
	seen := make(map[int64]bool, len(ids))
	unique := make([]int64, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		unique = append(unique, id)
	}
	return unique
}

func containsID(ids []int64, id int64) bool {
	return indexOfID(ids, id) >= 0
}

func indexOfID(ids []int64, id int64) int {
	for index, candidate := range ids {
		if candidate == id {
			return index
		}
	}
	return -1
}

func (s *PlayerService) pruneSession(session PlayerSession) (PlayerSession, error) {
	session = normalizeSession(session)
	if len(session.QueueIDs) == 0 {
		session.TrackID = 0
		session.PositionMs = 0
		session.ShuffleOrder = []int64{}
		return session, nil
	}

	present, err := s.library.store.ExistingTrackIDs(session.QueueIDs)
	if err != nil {
		return PlayerSession{}, err
	}
	queue := make([]int64, 0, len(session.QueueIDs))
	for _, id := range session.QueueIDs {
		if present[id] {
			queue = append(queue, id)
		}
	}
	if len(queue) == 0 {
		session.TrackID = 0
		session.PositionMs = 0
		session.QueueIDs = []int64{}
		session.QueueIndex = 0
		session.ShuffleOrder = []int64{}
		return session, nil
	}

	current := session.TrackID
	if !present[current] {
		index := session.QueueIndex
		if index < 0 {
			index = 0
		}
		if index >= len(queue) {
			index = len(queue) - 1
		}
		current = queue[index]
		session.PositionMs = 0
	}
	session.TrackID = current
	session.QueueIDs = queue
	for index, id := range queue {
		if id == current {
			session.QueueIndex = index
			break
		}
	}

	// Keep a stable shuffled order, dropping missing tracks and appending any
	// queue entries that were added after the session was saved.
	order := make([]int64, 0, len(queue))
	seen := make(map[int64]bool, len(queue))
	for _, id := range session.ShuffleOrder {
		if present[id] && !seen[id] {
			order = append(order, id)
			seen[id] = true
		}
	}
	for _, id := range queue {
		if !seen[id] {
			order = append(order, id)
			seen[id] = true
		}
	}
	session.ShuffleOrder = order
	return session, nil
}
