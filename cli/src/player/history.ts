import { promises as fs } from "node:fs";
import { legacyHistoryFile } from "../config/paths";
import { type AnalyticsSnapshot, NovaDatabase } from "../db/database";

interface LegacyHistoryIndex {
  version: 1;
  entries: Array<{ id: string; at: string }>;
}

/** Listening history and analytics backed by the shared NovaPlayer database. */
export class PlayHistory {
  private version = 0;
  private listeners = new Set<() => void>();

  private constructor(private readonly database: NovaDatabase) {}

  static empty(): PlayHistory {
    return new PlayHistory(NovaDatabase.memory());
  }

  static async load(database = NovaDatabase.open()): Promise<PlayHistory> {
    const history = new PlayHistory(database);
    await history.migrateLegacyJson();
    return history;
  }

  private async migrateLegacyJson(): Promise<void> {
    if (this.database.recentHistory().length > 0) return;
    try {
      const raw = await fs.readFile(legacyHistoryFile, "utf8");
      const parsed = JSON.parse(raw) as LegacyHistoryIndex;
      if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) return;
      for (const entry of [...parsed.entries].reverse()) {
        if (this.database.hasTrack(entry.id)) this.database.recordPlay(entry.id, 0, entry.at);
      }
      if (parsed.entries.length > 0) this.notify();
    } catch {
      // No legacy history is a normal first launch.
    }
  }

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

  /** Unique recent track ids, newest first; replays do not clutter the UI. */
  ids(): string[] {
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const entry of this.database.recentHistory()) {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        ids.push(entry.id);
      }
    }
    return ids;
  }

  record(id: string, durationSec = 0): void {
    this.database.recordPlay(id, durationSec);
    this.notify();
  }

  retain(existing: (id: string) => boolean): void {
    // Foreign keys already remove history when a track is deleted. This method
    // remains for API compatibility with the reconciliation flow.
    if (this.ids().some((id) => !existing(id))) this.notify();
  }

  analytics(): AnalyticsSnapshot {
    return this.database.analytics();
  }
}
