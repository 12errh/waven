import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTrackToPlaylist,
  computeSeekTime,
  filterTracksByGenre,
  filterTracksByQuery,
  formatLikesCount,
  formatTimeMMSS,
  formatTrackRowDuration,
  getNextTrackId,
  getPrevTrackId,
  groupTracksByAlbum,
  groupTracksByArtist,
  removeTrackFromPlaylist,
} from './player-logic';
import type { Playlist, Track } from './types';

const sampleTracks: Track[] = [
  {
    id: 't1',
    title: 'Flowers',
    artist: 'Miley Cyrus',
    album: 'Endless Summer Vacation',
    genre: 'Pop',
    year: 2024,
    durationSec: 192,
    coverSrc: '/a.jpg',
    likesCount: 2_800_000,
  },
  {
    id: 't2',
    title: 'Lunch',
    artist: 'Billie Eilish',
    album: 'HIT ME HARD AND SOFT',
    genre: 'Alt-Pop',
    year: 2024,
    durationSec: 180,
    coverSrc: '/b.jpg',
    likesCount: 1_450_000,
  },
  {
    id: 't3',
    title: 'Sports Car',
    artist: 'Tate McRae',
    album: 'So Close To What',
    genre: 'Dance-Pop',
    year: 2025,
    durationSec: 210,
    coverSrc: '/c.jpg',
    likesCount: 950,
  },
];

test('time and likes formatting produce exact expected strings', () => {
  assert.equal(formatTimeMMSS(43), '00:43');
  assert.equal(formatTimeMMSS(192), '03:12');
  assert.equal(formatTimeMMSS(-5), '00:00');
  assert.equal(formatTrackRowDuration(210), '3:30');
  assert.equal(formatLikesCount(2_800_000), '2.8M likes');
  assert.equal(formatLikesCount(12_400), '12.4K likes');
  assert.equal(formatLikesCount(950), '950 likes');
});

test('getNextTrackId handles sequential, repeat-one, wrap-around, and shuffle', () => {
  const queueIds = ['t1', 't2', 't3'];
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 't1', shuffle: false, repeat: 'off' }),
    't2'
  );
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 't3', shuffle: false, repeat: 'all' }),
    't1'
  );
  assert.equal(
    getNextTrackId({ queueIds, currentTrackId: 't2', shuffle: false, repeat: 'one' }),
    't2'
  );
  const shuffled = getNextTrackId({
    queueIds,
    currentTrackId: 't1',
    shuffle: true,
    repeat: 'off',
    randomFn: () => 0.9,
  });
  assert.equal(shuffled, 't3');
});

test('getPrevTrackId wraps around cleanly', () => {
  const queueIds = ['t1', 't2', 't3'];
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 't2' }), 't1');
  assert.equal(getPrevTrackId({ queueIds, currentTrackId: 't1' }), 't3');
});

test('search and genre filters match accurately', () => {
  assert.equal(filterTracksByQuery(sampleTracks, 'billie').length, 1);
  assert.equal(filterTracksByQuery(sampleTracks, 'endless')[0].id, 't1');
  assert.equal(filterTracksByGenre(sampleTracks, 'Pop').length, 1);
  assert.equal(filterTracksByGenre(sampleTracks, 'All').length, 3);
});

test('grouping helpers aggregate artists and albums', () => {
  assert.equal(groupTracksByArtist(sampleTracks).length, 3);
  assert.equal(groupTracksByAlbum(sampleTracks).length, 3);
});

test('playlist add and remove avoid duplicates and preserve immutability', () => {
  const initial: Playlist[] = [
    { id: 'p1', name: 'Late Night', description: '', trackIds: ['t1'], coverSrc: '/a.jpg', createdAt: 1 },
  ];
  const added = addTrackToPlaylist(initial, 'p1', 't2');
  assert.deepEqual(added[0].trackIds, ['t1', 't2']);
  const deduped = addTrackToPlaylist(added, 'p1', 't2');
  assert.deepEqual(deduped[0].trackIds, ['t1', 't2']);
  const removed = removeTrackFromPlaylist(deduped, 'p1', 't1');
  assert.deepEqual(removed[0].trackIds, ['t2']);
});

test('computeSeekTime clamps ratios between 0 and 1', () => {
  assert.equal(computeSeekTime(0.5, 200), 100);
  assert.equal(computeSeekTime(-0.2, 200), 0);
  assert.equal(computeSeekTime(1.5, 200), 200);
});
