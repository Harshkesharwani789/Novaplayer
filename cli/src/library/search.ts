import type { Track } from "./types";

export interface SearchResult {
  track: Track;
  score: number;
}

/** A small deterministic fuzzy matcher for titles, artists, albums and playlists. */
export function fuzzyScore(query: string, candidate: string): number {
  const q = query.trim().toLocaleLowerCase();
  const value = candidate.toLocaleLowerCase();
  if (!q) return 1;
  if (value === q) return 1000;
  const direct = value.indexOf(q);
  if (direct >= 0) return 700 - direct * 2 - Math.max(0, value.length - q.length);
  let at = 0;
  let score = 0;
  let previous = -2;
  for (const char of q) {
    const found = value.indexOf(char, at);
    if (found < 0) return 0;
    score += 20;
    if (found === previous + 1) score += 15;
    if (found === 0 || /[\s\-_/([.]/.test(value[found - 1] ?? "")) score += 12;
    score -= found - at;
    previous = found;
    at = found + 1;
  }
  return Math.max(1, score);
}

export function searchTracks(tracks: Track[], query: string): SearchResult[] {
  const q = query.trim();
  if (!q) return tracks.map((track) => ({ track, score: 1 }));
  return tracks
    .map((track) => {
      const fields: Array<[string | undefined, number]> = [
        [track.title, 1], [track.artist, 0.85], [track.album, 0.7], [track.playlist, 0.65],
      ];
      const score = Math.max(...fields.map(([value, weight]) => fuzzyScore(q, value ?? "") * weight));
      return { track, score };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.track.addedAt.localeCompare(a.track.addedAt));
}
