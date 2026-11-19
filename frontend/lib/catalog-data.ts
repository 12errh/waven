import { CATALOG_IMAGES } from './catalog-images';
import type { Playlist, Track } from './types';

export const INITIAL_TRACKS: Track[] = [
  {
    id: 'track-flowers',
    title: 'Flowers',
    artist: 'Miley Cyrus',
    album: 'Endless Summer Vacation',
    genre: 'Pop',
    year: 2024,
    durationSec: 192,
    coverSrc: CATALOG_IMAGES.flowers,
    badgeLabel: 'New release',
    releaseMeta: 'Single · 2024 · 2 Songs',
    likesCount: 2_800_000,
    accentHex: '#2c6cb0',
    synth: {
      bpm: 118,
      rootHz: 220, // A3
      chords: [
        [220, 261.63, 329.63], // Am
        [146.83, 174.61, 220], // Dm
        [196.0, 246.94, 293.66], // G
        [130.81, 164.81, 196.0], // C
      ],
      padColor: 'bright',
    },
  },
  {
    id: 'track-manchild',
    title: 'Manchild',
    artist: 'Sabrina Carpenter',
    album: 'Manchild',
    genre: 'Pop',
    year: 2025,
    durationSec: 210,
    coverSrc: CATALOG_IMAGES.champagne,
    badgeLabel: 'Featured',
    releaseMeta: 'Single · 2025 · 1 Song',
    likesCount: 1_420_000,
    accentHex: '#b8864b',
    synth: {
      bpm: 122,
      rootHz: 246.94, // B3
      chords: [
        [246.94, 311.13, 369.99],
        [220, 277.18, 329.63],
        [185, 220, 277.18],
        [196, 246.94, 293.66],
      ],
      padColor: 'warm',
    },
  },
  {
    id: 'track-sports-car',
    title: 'Sports Car',
    artist: 'Tate McRae',
    album: 'So Close To What',
    genre: 'Dance-Pop',
    year: 2025,
    durationSec: 210,
    coverSrc: CATALOG_IMAGES.motorsport,
    badgeLabel: 'Trending',
    releaseMeta: 'Single · 2025 · 2 Songs',
    likesCount: 980_000,
    accentHex: '#c48332',
    synth: {
      bpm: 126,
      rootHz: 196.0,
      chords: [
        [196, 233.08, 293.66],
        [174.61, 207.65, 261.63],
        [155.56, 196, 233.08],
        [146.83, 174.61, 220],
      ],
      padColor: 'nocturnal',
    },
  },
  {
    id: 'track-die-with-a-smile',
    title: 'Die With A Smile',
    artist: 'Lady Gaga & Bruno Mars',
    album: 'Die With A Smile',
    genre: 'Soul-Pop',
    year: 2024,
    durationSec: 210,
    coverSrc: CATALOG_IMAGES.technicolor,
    badgeLabel: 'Top Chart',
    releaseMeta: 'Single · 2024 · 1 Song',
    likesCount: 3_400_000,
    accentHex: '#3f69b8',
    synth: {
      bpm: 80,
      rootHz: 220,
      chords: [
        [220, 277.18, 329.63],
        [185, 220, 277.18],
        [146.83, 185, 220],
        [164.81, 207.65, 246.94],
      ],
      padColor: 'warm',
    },
  },
  {
    id: 'track-lunch',
    title: 'Lunch',
    artist: 'Billie Eilish',
    album: 'HIT ME HARD AND SOFT',
    genre: 'Alt-Pop',
    year: 2024,
    durationSec: 210,
    coverSrc: CATALOG_IMAGES.taupe,
    badgeLabel: 'New release',
    releaseMeta: 'Single · 2024 · 2 Songs',
    likesCount: 2_150_000,
    accentHex: '#967c63',
    synth: {
      bpm: 125,
      rootHz: 164.81,
      chords: [
        [164.81, 196, 246.94],
        [146.83, 174.61, 220],
        [130.81, 164.81, 196],
        [123.47, 146.83, 196],
      ],
      padColor: 'nocturnal',
    },
  },
  {
    id: 'track-love-on',
    title: 'Love On',
    artist: 'Selena Gomez',
    album: 'Love On',
    genre: 'Pop',
    year: 2024,
    durationSec: 184,
    coverSrc: CATALOG_IMAGES.prism,
    badgeLabel: 'New release',
    releaseMeta: 'Single · 2024 · 2 Songs',
    likesCount: 1_890_000,
    accentHex: '#c87248',
    synth: {
      bpm: 114,
      rootHz: 261.63,
      chords: [
        [261.63, 329.63, 392.0],
        [220, 261.63, 329.63],
        [174.61, 220, 261.63],
        [196, 246.94, 293.66],
      ],
      padColor: 'warm',
    },
  },
  {
    id: 'track-houdini',
    title: 'Houdini',
    artist: 'Dua Lipa',
    album: 'Radical Optimism',
    genre: 'Synth-Pop',
    year: 2024,
    durationSec: 186,
    coverSrc: CATALOG_IMAGES.convertible,
    badgeLabel: 'New release',
    releaseMeta: 'Single · 2024 · 2 Songs',
    likesCount: 1_640_000,
    accentHex: '#b04875',
    synth: {
      bpm: 117,
      rootHz: 146.83,
      chords: [
        [146.83, 174.61, 220],
        [174.61, 220, 261.63],
        [130.81, 164.81, 196],
        [196, 233.08, 293.66],
      ],
      padColor: 'nocturnal',
    },
  },
  {
    id: 'track-birds-of-a-feather',
    title: 'Golden Silence',
    artist: 'Billie Eilish',
    album: 'HIT ME HARD AND SOFT',
    genre: 'Indie',
    year: 2024,
    durationSec: 210,
    coverSrc: CATALOG_IMAGES.taupe,
    badgeLabel: 'Editor Pick',
    releaseMeta: 'Album · 2024 · 10 Songs',
    likesCount: 2_310_000,
    accentHex: '#a38971',
    synth: {
      bpm: 105,
      rootHz: 196.0,
      chords: [
        [196, 246.94, 293.66],
        [164.81, 196, 246.94],
        [220, 261.63, 329.63],
        [146.83, 185, 220],
      ],
      padColor: 'warm',
    },
  },
];

// The 3 featured tilted release cards shown at top-left in Discover
export const FEATURED_CARD_TRACK_IDS = [
  'track-love-on',
  'track-lunch',
  'track-houdini',
];

// The 5 primary rows in the Discover tracklist matching the reference
export const DISCOVER_TRACKLIST_IDS = [
  'track-flowers',
  'track-manchild',
  'track-sports-car',
  'track-die-with-a-smile',
  'track-lunch',
];

export const INITIAL_PLAYLISTS: Playlist[] = [
  {
    id: 'pl-midnight-velvet',
    name: 'Midnight Glass',
    description: 'Late-night alt-pop, synth drives, and warm vocals.',
    trackIds: ['track-flowers', 'track-sports-car', 'track-houdini', 'track-lunch'],
    coverSrc: CATALOG_IMAGES.convertible,
    createdAt: 1730000000000,
  },
  {
    id: 'pl-golden-hour',
    name: 'Golden Hour Pop',
    description: 'Sunlit choruses and modern anthems.',
    trackIds: ['track-love-on', 'track-manchild', 'track-die-with-a-smile'],
    coverSrc: CATALOG_IMAGES.champagne,
    createdAt: 1730050000000,
  },
];
