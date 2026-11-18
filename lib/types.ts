export type TopTab = 'Discover' | 'Playlists' | 'Artists' | 'Albums' | 'Genres';

export type DockSection = 'home' | 'search' | 'library' | 'likes' | 'profile';

export type RepeatMode = 'off' | 'all' | 'one';

export interface SynthProfile {
  bpm: number;
  rootHz: number;
  chords: number[][];
  padColor: 'warm' | 'bright' | 'nocturnal';
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string;
  genre: string;
  year: number;
  durationSec: number;
  coverSrc: string;
  badgeLabel?: string;
  releaseMeta?: string;
  likesCount: number;
  audioUrl?: string;
  isLocalUpload?: boolean;
  isExternalSearch?: boolean;
  accentHex?: string;
  synth?: SynthProfile;
}

export interface Playlist {
  id: string;
  name: string;
  description: string;
  trackIds: string[];
  coverSrc: string;
  createdAt: number;
}
