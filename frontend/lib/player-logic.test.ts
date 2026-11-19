import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildShuffleOrder,
  clampResumeSeconds,
  computeSeekTime,
  filterTracksByGenre,
  filterTracksByQuery,
  formatLibraryDuration,
  formatTimeMMSS,
  formatTrackRowDuration,
  getNextTrackId,
  getPlaybackOrder,
  getPrevTrackId,
  groupTracksByAlbum,
  groupTracksByArtist,
  normalizePlayerSession,
  playRecordThresholdSeconds,
} from './player-logic.ts';
import type { Track } from './types.ts';

function track(id: number, title: string, artist: string, album: string, genre: string): Track {
  return {
    id,
    title,
    artist,
    album,
    albumArtist: artist,
    genre,
    year: 2024,
    trackNo: 1,
    discNo: 1,
    durationMs: 192000,
    durationSec: 192,
    bitrateKbps: 320,
    sampleRate: 44100,
    channels: 2,
    format: 'mp3',
    sizeBytes: 1,
    artId: '',
    coverSrc: '',
    accentHex: '',
    audioUrl: '',
    liked: false,
    missing: false,
    addedAt: 0,
  };
}

const sampleTracks: Track[] = [
  track(1, 'Flowers', 'Miley Cyrus', 'Endless Summer Vacation', 'Pop'),
  track(2, 'Lunch', 'Billie Eilish', 'HIT ME HARD AND SOFT', 'Alt-Pop'),
  track(3, 'Sports Car', 'Tate McRae', 'So Close To What', 'Dance-Pop'),
];

test('time and library duration formatting produce exact expected strings', () => {
  assert.equal(formatTimeMMSS(43), '00:43');
  assert.equal(formatTimeMMSS(192), '03:12');
  assert.equal(formatTimeMMSS(-5), '00:00');
  assert.equal(formatTrackRowDuration(210), '3:30');
  assert.equal(formatLibraryDuration(45 * 60_000), '45 min');
  assert.equal(formatLibraryDuration(3 * 3600_000 + 20 * 60_000), '3 hr 20 min');
  assert.equal(formatLibraryDuration(2 * 3600_000), '2 hr');
});

test('getNextTrackId handles sequential, repeat-one, wrap-around, shuffle, and stop', () => {
  const queueIds = [1, 2, 3];
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 1, shuffle: false, repeat: 'off' }),
    2
  );
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 3, shuffle: false, repeat: 'all' }),
    1
  );
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 3, shuffle: false, repeat: 'off' }),
    null
  );
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 2, shuffle: false, repeat: 'one' }),
    3
  );
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 2,
      shuffle: false,
      repeat: 'one',
      autoAdvance: true,
    }),
    2
  );
  const shuffled = getNextTrackId({
    queueIds,
    currentTrackId: 1,
    shuffle: true,
    repeat: 'off',
    randomFn: () => 0.9,
  });
  // Shuffle keeps the active track first, so the next track follows the
  // shuffled remainder rather than jumping across the whole queue.
  assert.equal(shuffled, 2);
});

test('getPrevTrackId wraps around cleanly', () => {
  const queueIds = [1, 2, 3];
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 2 }), 1);
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 1 }), null);
  assert.equal(
    getPrevTrackId({ queueIds, currentTrackId: 1, repeat: 'all' }),
    3
  );
});

test('stable shuffle keeps the active track first and preserves the saved order', () => {
  const order = buildShuffleOrder([1, 2, 3, 4], 2, () => 0.5);
  assert.equal(order[0], 2);
  assert.deepEqual([...order].sort(), [1, 2, 3, 4]);

  const playback = getPlaybackOrder([1, 2, 3, 4], true, [2, 4, 1, 3]);
  assert.deepEqual(playback, [2, 4, 1, 3]);

  // Removed tracks drop out and tracks added after the order was built append.
  assert.deepEqual(getPlaybackOrder([2, 1, 5], true, [2, 4, 1, 3]), [2, 1, 5]);
  assert.deepEqual(getPlaybackOrder([1, 2, 3], false, [3, 1, 2]), [1, 2, 3]);
});

test('shuffle advances through the stable order and wraps only with repeat-all', () => {
  const queueIds = [1, 2, 3, 4];
  const shuffleOrder = [3, 1, 4, 2];
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 3,
      shuffle: true,
      shuffleOrder,
      repeat: 'off',
    }),
    1
  );
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 3,
      shuffle: true,
      shuffleOrder,
      repeat: 'off',
      autoAdvance: true,
    }),
    1
  );
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 2,
      shuffle: true,
      shuffleOrder,
      repeat: 'off',
    }),
    null
  );
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 2,
      shuffle: true,
      shuffleOrder,
      repeat: 'all',
    }),
    3
  );
  assert.equal(
    getPrevTrackId({
      queueIds,
      currentTrackId: 3,
      shuffle: true,
      shuffleOrder,
      repeat: 'all',
    }),
    2
  );
});

test('repeat-one replays only on a natural ending, never on a manual next', () => {
  const queueIds = [1, 2, 3];
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 2,
      shuffle: false,
      repeat: 'one',
      autoAdvance: true,
    }),
    2
  );
  assert.equal(
    getNextTrackId({
      queueIds,
      currentTrackId: 2,
      shuffle: false,
      repeat: 'one',
    }),
    3
  );
});

test('session normalization clamps values and keeps the queue coherent', () => {
  const session = normalizePlayerSession({
    trackId: 3,
    positionMs: -50,
    queueIds: [1, 2, 2, 3, 0],
    shuffle: true,
    shuffleOrder: [3, 99, 1],
    repeat: 'one',
    volume: 2,
    muted: true,
  });
  assert.deepEqual(session.queueIds, [1, 2, 3]);
  assert.equal(session.trackId, 3);
  assert.equal(session.queueIndex, 2);
  assert.equal(session.positionMs, 0);
  assert.equal(session.volume, 1);
  assert.equal(session.repeat, 'one');
  assert.equal(session.shuffleOrder[0], 3);
  assert.deepEqual([...session.shuffleOrder].sort(), [1, 2, 3]);

  const fallback = normalizePlayerSession({ repeat: 'bogus' as never, queueIds: [7] });
  assert.equal(fallback.trackId, 7);
  assert.equal(fallback.repeat, 'off');
  assert.equal(fallback.volume, 0.8);
  assert.deepEqual(fallback.shuffleOrder, []);

  // A saved order is authoritative: the active track keeps its place so
  // restoring never changes which track is next.
  const preserved = normalizePlayerSession({
    trackId: 3,
    queueIds: [1, 2, 3],
    shuffle: true,
    shuffleOrder: [2, 1, 3],
  });
  assert.deepEqual(preserved.shuffleOrder, [2, 1, 3]);

  // A session with shuffle but no stored order gets a stable order that starts
  // at the active track.
  const generated = normalizePlayerSession({
    trackId: 2,
    queueIds: [1, 2, 3],
    shuffle: true,
  });
  assert.equal(generated.shuffleOrder[0], 2);
  assert.deepEqual([...generated.shuffleOrder].sort(), [1, 2, 3]);
});

test('resume positions never land at the very end and play thresholds are sane', () => {
  assert.equal(clampResumeSeconds(95_000, 100), 95);
  assert.equal(clampResumeSeconds(99_500, 100), 98);
  assert.equal(clampResumeSeconds(10_000, 0), 10);
  assert.equal(playRecordThresholdSeconds(200), 30);
  assert.equal(playRecordThresholdSeconds(40), 20);
  assert.equal(playRecordThresholdSeconds(0), 30);
});

test('search and genre filters match accurately', () => {
  assert.equal(filterTracksByQuery(sampleTracks, 'billie').length, 1);
  assert.equal(filterTracksByQuery(sampleTracks, 'endless')[0].id, 1);
  assert.equal(filterTracksByGenre(sampleTracks, 'Pop').length, 1);
  assert.equal(filterTracksByGenre(sampleTracks, 'All').length, 3);
});

test('grouping helpers aggregate artists and albums', () => {
  assert.equal(groupTracksByArtist(sampleTracks).length, 3);
  assert.equal(groupTracksByAlbum(sampleTracks).length, 3);
});

test('computeSeekTime clamps ratios between 0 and 1', () => {
  assert.equal(computeSeekTime(0.5, 200), 100);
  assert.equal(computeSeekTime(-0.2, 200), 0);
  assert.equal(computeSeekTime(1.5, 200), 200);
});
