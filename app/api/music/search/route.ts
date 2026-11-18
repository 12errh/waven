import { NextRequest, NextResponse } from 'next/server';
import { INITIAL_TRACKS } from '@/lib/catalog-data';
import { filterTracksByQuery } from '@/lib/player-logic';
import type { Track } from '@/lib/types';

interface ITunesSong {
  trackId: number;
  trackName: string;
  artistName: string;
  collectionName?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) {
    return NextResponse.json({ tracks: INITIAL_TRACKS, source: 'catalog' });
  }

  const localMatches = filterTracksByQuery(INITIAL_TRACKS, q);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
      q
    )}&media=music&entity=song&limit=20`;

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    clearTimeout(timer);

    if (!res.ok) {
      return NextResponse.json({ tracks: localMatches, source: 'local-fallback' });
    }

    const data = (await res.json()) as { results?: ITunesSong[] };
    const remoteTracks: Track[] = (data.results ?? [])
      .filter((item) => item.trackName && item.artistName && item.previewUrl)
      .map((item) => {
        const highResArt = (item.artworkUrl100 ?? '').replace('100x100bb', '600x600bb');
        const year = item.releaseDate ? new Date(item.releaseDate).getFullYear() : 2024;
        return {
          id: `itunes-${item.trackId}`,
          title: item.trackName,
          artist: item.artistName,
          album: item.collectionName || 'Single',
          genre: item.primaryGenreName || 'Pop',
          year: Number.isFinite(year) ? year : 2024,
          durationSec: item.trackTimeMillis ? Math.round(item.trackTimeMillis / 1000) : 30,
          coverSrc: highResArt || INITIAL_TRACKS[0].coverSrc,
          badgeLabel: 'Stream',
          releaseMeta: `Track · ${Number.isFinite(year) ? year : 2024} · Preview`,
          likesCount: 120_000 + (item.trackId % 900_000),
          audioUrl: item.previewUrl,
          isExternalSearch: true,
        };
      });

    // Deduplicate local + remote
    const seen = new Set(localMatches.map((t) => `${t.title.toLowerCase()}::${t.artist.toLowerCase()}`));
    const merged = [
      ...localMatches,
      ...remoteTracks.filter(
        (t) => !seen.has(`${t.title.toLowerCase()}::${t.artist.toLowerCase()}`)
      ),
    ];

    return NextResponse.json({ tracks: merged, source: 'itunes' });
  } catch {
    return NextResponse.json({ tracks: localMatches, source: 'local-fallback' });
  }
}
