import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTrackToPlaylist,
  computeSeekTime,
  filterTracksByGenre,
  filterTracksByQuery,
  formatLibraryDuration,
  formatTimeMMSS,
  formatTrackRowDuration,
  getNextTrackId,
  getPrevTrackId,
  groupTracksByAlbum,
  groupTracksByArtist,
  removeTrackFromPlaylist,
} from './player-logic';
import type { Playlist, Track } from './types';

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
    2
  );
  const shuffled = getNextTrackId({
    queueIds,
    currentTrackId: 1,
    shuffle: true,
    repeat: 'off',
    randomFn: () => 0.9,
  });
  assert.equal(shuffled, 3);
});

test('getPrevTrackId wraps around cleanly', () => {
  const queueIds = [1, 2, 3];
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 2 }), 1);
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 1 }), 3);
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

test('playlist add and remove avoid duplicates and preserve immutability', () => {
  const initial: Playlist[] = [
    { id: 'p1', name: 'Late Night', description: '', trackIds: [1], coverSrc: '/a.jpg', createdAt: 1 },
  ];
  const added = addTrackToPlaylist(initial, 'p1', 2);
  assert.deepEqual(added[0].trackIds, [1, 2]);
  const deduped = addTrackToPlaylist(added, 'p1', 2);
  assert.deepEqual(deduped[0].trackIds, [1, 2]);
  const removed = removeTrackFromPlaylist(deduped, 'p1', 1);
  assert.deepEqual(removed[0].trackIds, [2]);
  assert.deepEqual(initial[0].trackIds, [1]);
});

test('computeSeekTime clamps ratios between 0 and 1', () => {
  assert.equal(computeSeekTime(0.5, 200), 100);
  assert.equal(computeSeekTime(-0.2, 200), 0);
  assert.equal(computeSeekTime(1.5, 200), 200);
});
