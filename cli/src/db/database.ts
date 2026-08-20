import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { databaseFile } from "../config/paths";
import type { Track } from "../library/types";

// esbuild's bundler (used by tsup for the published CLI build) ships a
// hardcoded table of "node core modules with a legacy bare-name alias" and
// rewrites `import ... from "node:sqlite"` down to bare `from "sqlite"` —
// there is no such bare builtin, only the `node:`-prefixed form exists, so
// the bundled dist/index.js threw ERR_MODULE_NOT_FOUND on every launch.
// Routing the load through createRequire keeps the exact specifier string
// out of static import analysis, so the bundler can't "helpfully" mangle it.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as
  typeof import("node:sqlite");
type DatabaseSync = InstanceType<typeof import("node:sqlite").DatabaseSync>;

export interface HistoryRecord {
  id: string;
  at: string;
  durationSec: number;
}

export interface AnalyticsSnapshot {
  totalListeningSec: number;
  topArtists: Array<{ name: string; plays: number }>;
  topAlbums: Array<{ name: string; plays: number }>;
  topTracks: Array<{ id: string; title: string; plays: number }>;
  topGenres: Array<{ name: string; plays: number }>;
  recentActivity: HistoryRecord[];
}

interface TrackRow {
  id: string;
  source: Track["source"];
  source_track_id: string;
  title: string;
  artist: string | null;
  album: string | null;
  duration_sec: number | null;
  file_path: string;
  webpage_url: string | null;
  playlist: string | null;
  owner: string | null;
  added_at: string;
  spotify_id: string | null;
  genre: string | null;
  artwork_path: string | null;
  file_size: number | null;
  file_modified_at: string | null;
  fingerprint: string | null;
}

const shared = new Map<string, NovaDatabase>();

/**
 * Thin synchronous repository over Node's built-in SQLite. All calls are tiny
 * local transactions; keeping this layer dependency-free makes NovaPlayer
 * installable with `npm` alone.
 */
export class NovaDatabase {
  private readonly db: DatabaseSync;

  private constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  static open(filename = databaseFile): NovaDatabase {
    if (filename === ":memory:") return new NovaDatabase(filename);
    const known = shared.get(filename);
    if (known) return known;
    const database = new NovaDatabase(filename);
    shared.set(filename, database);
    return database;
  }

  static memory(): NovaDatabase {
    return NovaDatabase.open(":memory:");
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS artists (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS albums (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        artist_id INTEGER REFERENCES artists(id) ON DELETE SET NULL,
        artwork_path TEXT,
        UNIQUE(name, artist_id)
      );
      CREATE TABLE IF NOT EXISTS tracks (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_track_id TEXT NOT NULL,
        title TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        duration_sec INTEGER,
        file_path TEXT NOT NULL UNIQUE,
        webpage_url TEXT,
        playlist TEXT,
        owner TEXT,
        added_at TEXT NOT NULL,
        spotify_id TEXT,
        genre TEXT,
        artwork_path TEXT,
        file_size INTEGER,
        file_modified_at TEXT,
        fingerprint TEXT,
        UNIQUE(source, source_track_id, owner)
      );
      CREATE TABLE IF NOT EXISTS playlists (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playlist_tracks (
        playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        added_at TEXT NOT NULL,
        PRIMARY KEY (playlist_id, track_id)
      );
      CREATE TABLE IF NOT EXISTS history (
        id INTEGER PRIMARY KEY,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
        played_at TEXT NOT NULL,
        duration_sec INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS downloads (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        track_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        queued_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playback_queue (
        position INTEGER PRIMARY KEY,
        track_id TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS history_played_at_idx ON history(played_at DESC);
      CREATE INDEX IF NOT EXISTS tracks_added_at_idx ON tracks(added_at DESC);
      CREATE INDEX IF NOT EXISTS tracks_fingerprint_idx ON tracks(fingerprint);
    `);
  }

  allTracks(): Track[] {
    const rows = this.db.prepare("SELECT * FROM tracks ORDER BY added_at DESC").all() as unknown as TrackRow[];
    return rows.map(trackFromRow);
  }

  getTrack(id: string): Track | undefined {
    const row = this.db.prepare("SELECT * FROM tracks WHERE id = ?").get(id) as TrackRow | undefined;
    return row ? trackFromRow(row) : undefined;
  }

  hasTrack(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tracks WHERE id = ?").get(id));
  }

  /**
   * Move an existing row — and everything referencing it — to a new id.
   *
   * `tracks.id` is referenced by `history`, `playlist_tracks` and
   * `playback_queue` with no ON UPDATE clause, so re-keying the parent while
   * children still point at the old id would trip the FK check mid-statement.
   * `PRAGMA defer_foreign_keys` holds that check until COMMIT, which lets the
   * parent and its children move together in one atomic step. Deleting and
   * re-inserting instead would silently drop the user's play history for a
   * song whose file merely got re-tagged.
   */
  private rekeyTrack(oldId: string, newId: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.exec("PRAGMA defer_foreign_keys = ON");
      this.db.prepare("UPDATE tracks SET id = ? WHERE id = ?").run(newId, oldId);
      for (const table of ["history", "playlist_tracks", "playback_queue"]) {
        this.db
          .prepare(`UPDATE ${table} SET track_id = ? WHERE track_id = ?`)
          .run(newId, oldId);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  upsertTrack(track: Track): void {
    // `tracks` has THREE unique keys: the `id` primary key, `file_path`, and
    // `(source, source_track_id, owner)`. The upsert below only resolves the
    // first, so an incoming track that collides on either of the others under a
    // different id aborts the whole statement — and, because scanLibrary walks
    // files in a loop, takes every remaining file in the scan down with it.
    //
    // The realistic trigger: the scanner derives a track's id from a content
    // fingerprint, so re-tagging or re-encoding a file already in the library
    // produces a NEW id for the SAME file_path. That is not a new track, it is
    // the same track with new bytes, so the correct resolution is to move the
    // existing row (and its play history) onto the new id rather than to fail.
    const clashes = this.db
      .prepare(
        `SELECT id FROM tracks
          WHERE (file_path = ?
                 OR (source = ? AND source_track_id = ? AND owner IS ?))
            AND id <> ?`,
      )
      .all(
        track.filePath,
        track.source,
        track.sourceTrackId,
        track.owner ?? null,
        track.id,
      ) as Array<{ id: string }>;
    if (clashes.length > 0) {
      // Re-key the first claimant onto the incoming id; any further rows are
      // stale duplicates that cannot coexist with it under these constraints.
      this.rekeyTrack(clashes[0]!.id, track.id);
      for (const extra of clashes.slice(1)) this.removeTrack(extra.id);
    }
    this.db.prepare(`
      INSERT INTO tracks (
        id, source, source_track_id, title, artist, album, duration_sec,
        file_path, webpage_url, playlist, owner, added_at, spotify_id, genre,
        artwork_path, file_size, file_modified_at, fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source = excluded.source, source_track_id = excluded.source_track_id,
        title = excluded.title, artist = excluded.artist, album = excluded.album,
        duration_sec = excluded.duration_sec, file_path = excluded.file_path,
        webpage_url = excluded.webpage_url, playlist = excluded.playlist,
        owner = excluded.owner, added_at = excluded.added_at,
        spotify_id = excluded.spotify_id, genre = excluded.genre,
        artwork_path = excluded.artwork_path, file_size = excluded.file_size,
        file_modified_at = excluded.file_modified_at, fingerprint = excluded.fingerprint
    `).run(
      track.id, track.source, track.sourceTrackId, track.title, track.artist ?? null,
      track.album ?? null, track.durationSec ?? null, track.filePath,
      track.webpageUrl ?? null, track.playlist ?? null, track.owner ?? null,
      track.addedAt, track.spotifyId ?? null, track.genre ?? null,
      track.artworkPath ?? null, track.fileSize ?? null, track.fileModifiedAt ?? null,
      track.fingerprint ?? null,
    );
    if (track.artist) {
      this.db.prepare("INSERT OR IGNORE INTO artists (name) VALUES (?)").run(track.artist);
    }
    if (track.album) {
      const artist = track.artist
        ? (this.db.prepare("SELECT id FROM artists WHERE name = ?").get(track.artist) as { id: number } | undefined)?.id ?? null
        : null;
      this.db.prepare("INSERT OR IGNORE INTO albums (name, artist_id, artwork_path) VALUES (?, ?, ?)")
        .run(track.album, artist, track.artworkPath ?? null);
    }
  }

  removeTrack(id: string): void {
    this.db.prepare("DELETE FROM tracks WHERE id = ?").run(id);
  }

  clearTracks(): void {
    this.db.exec("DELETE FROM tracks;");
  }

  findByPath(filePath: string): Track | undefined {
    const row = this.db.prepare("SELECT * FROM tracks WHERE file_path = ?").get(filePath) as TrackRow | undefined;
    return row ? trackFromRow(row) : undefined;
  }

  findByFingerprint(fingerprint: string): Track | undefined {
    const row = this.db.prepare("SELECT * FROM tracks WHERE fingerprint = ? LIMIT 1").get(fingerprint) as TrackRow | undefined;
    return row ? trackFromRow(row) : undefined;
  }

  recordPlay(id: string, durationSec = 0, playedAt = new Date().toISOString()): void {
    this.db.prepare("INSERT INTO history (track_id, played_at, duration_sec) VALUES (?, ?, ?)")
      .run(id, playedAt, Math.max(0, Math.round(durationSec)));
  }

  recentHistory(): HistoryRecord[] {
    return this.db.prepare("SELECT track_id AS id, played_at AS at, duration_sec AS durationSec FROM history ORDER BY played_at DESC")
      .all() as unknown as HistoryRecord[];
  }

  analytics(): AnalyticsSnapshot {
    const number = (sql: string): number => (this.db.prepare(sql).get() as { value: number } | undefined)?.value ?? 0;
    const grouped = (sql: string): Array<{ name: string; plays: number }> =>
      this.db.prepare(sql).all() as Array<{ name: string; plays: number }>;
    return {
      totalListeningSec: number("SELECT COALESCE(SUM(duration_sec), 0) AS value FROM history"),
      topArtists: grouped("SELECT COALESCE(t.artist, 'Unknown artist') AS name, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id GROUP BY name ORDER BY plays DESC, name LIMIT 5"),
      topAlbums: grouped("SELECT COALESCE(t.album, 'Singles') AS name, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id GROUP BY name ORDER BY plays DESC, name LIMIT 5"),
      topTracks: this.db.prepare("SELECT t.id, t.title, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id GROUP BY t.id, t.title ORDER BY plays DESC, t.title LIMIT 5").all() as Array<{ id: string; title: string; plays: number }>,
      topGenres: grouped("SELECT COALESCE(t.genre, 'Unclassified') AS name, COUNT(*) AS plays FROM history h JOIN tracks t ON t.id = h.track_id GROUP BY name ORDER BY plays DESC, name LIMIT 5"),
      recentActivity: this.recentHistory().slice(0, 8),
    };
  }

  replaceDownloads(items: unknown[]): void {
    this.db.exec("DELETE FROM downloads;");
    const statement = this.db.prepare("INSERT INTO downloads (id, source, track_id, status, payload, queued_at) VALUES (?, ?, ?, ?, ?, ?)");
    for (const item of items) {
      const value = item as { source: string; track: { id: string }; status: string };
      statement.run(`queue:${value.source}:${value.track.id}`, value.source, value.track.id, value.status, JSON.stringify(item), new Date().toISOString());
    }
  }

  downloads<T>(): T[] {
    const rows = this.db.prepare("SELECT payload FROM downloads ORDER BY queued_at, id").all() as Array<{ payload: string }>;
    return rows.flatMap((row) => {
      try { return [JSON.parse(row.payload) as T]; } catch { return []; }
    });
  }

  saveQueue(trackIds: string[]): void {
    this.db.exec("DELETE FROM playback_queue;");
    const statement = this.db.prepare("INSERT INTO playback_queue (position, track_id) VALUES (?, ?)");
    trackIds.forEach((id, position) => statement.run(position, id));
  }

  loadQueue(): string[] {
    return (this.db.prepare("SELECT track_id FROM playback_queue ORDER BY position").all() as Array<{ track_id: string }>).map((row) => row.track_id);
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
      .run(key, JSON.stringify(value), new Date().toISOString());
  }

  getSetting<T>(key: string): T | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    if (!row) return undefined;
    try { return JSON.parse(row.value) as T; } catch { return undefined; }
  }

  createPlaylist(name: string): string {
    const id = `playlist:${Date.now().toString(36)}`;
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO playlists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, name, now, now);
    return id;
  }
}

function trackFromRow(row: TrackRow): Track {
  return {
    id: row.id, source: row.source, sourceTrackId: row.source_track_id,
    title: row.title, artist: row.artist ?? undefined, album: row.album ?? undefined,
    durationSec: row.duration_sec ?? undefined, filePath: row.file_path,
    webpageUrl: row.webpage_url ?? undefined, playlist: row.playlist ?? undefined,
    owner: row.owner ?? undefined, addedAt: row.added_at, spotifyId: row.spotify_id ?? undefined,
    genre: row.genre ?? undefined, artworkPath: row.artwork_path ?? undefined,
    fileSize: row.file_size ?? undefined, fileModifiedAt: row.file_modified_at ?? undefined,
    fingerprint: row.fingerprint ?? undefined,
  };
}
