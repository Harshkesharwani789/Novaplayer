import { promises as fs } from "node:fs";
import { legacyLibraryIndexFile } from "../config/paths";
import { NovaDatabase } from "../db/database";
import { searchTracks } from "./search";
import type { LibraryIndex, Track } from "./types";

/**
 * A local-first library repository backed by SQLite. The public API retains
 * the old Library shape so downloads, playback and existing extensions keep
 * working while persistence is upgraded under them.
 */
export class Library {
  private version = 0;
  private listeners = new Set<() => void>();

  private constructor(readonly database: NovaDatabase) {}

  getVersion(): number {
    return this.version;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    this.version++;
    for (const fn of this.listeners) fn();
  }

  static empty(): Library {
    return new Library(NovaDatabase.memory());
  }

  static async load(): Promise<Library> {
    const library = new Library(NovaDatabase.open());
    await library.migrateLegacyJson();
    return library;
  }

  /** Imports a prior JSON index exactly once; source data is retained. */
  private async migrateLegacyJson(): Promise<void> {
    if (this.all().length > 0) return;
    try {
      const raw = await fs.readFile(legacyLibraryIndexFile, "utf8");
      const index = JSON.parse(raw) as LibraryIndex;
      if (index?.version !== 1 || !index.tracks) return;
      for (const track of Object.values(index.tracks)) this.database.upsertTrack(track);
      if (Object.keys(index.tracks).length > 0) this.notify();
    } catch {
      // No legacy index is a normal first launch.
    }
  }

  all(): Track[] {
    return this.database.allTracks();
  }

  get(id: string): Track | undefined {
    return this.database.getTrack(id);
  }

  has(id: string): boolean {
    return this.database.hasTrack(id);
  }

  search(query: string): Track[] {
    return searchTracks(this.all(), query).map((result) => result.track);
  }

  async upsert(track: Track): Promise<void> {
    this.database.upsertTrack(track);
    this.notify();
  }

  async remove(id: string): Promise<void> {
    this.database.removeTrack(id);
    this.notify();
  }

  async clear(): Promise<void> {
    this.database.clearTracks();
    this.notify();
  }

  findByPath(filePath: string): Track | undefined {
    return this.database.findByPath(filePath);
  }

  findByFingerprint(fingerprint: string): Track | undefined {
    return this.database.findByFingerprint(fingerprint);
  }

  createPlaylist(name: string): string {
    const clean = name.trim();
    if (!clean) throw new Error("Playlist name cannot be empty.");
    return this.database.createPlaylist(clean);
  }
}
