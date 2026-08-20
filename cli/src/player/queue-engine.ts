import type { NovaDatabase } from "../db/database";
import type { Track } from "../library/types";
import type { RepeatMode } from "./playback";

/** Persistent, playback-specific queue (separate from the download queue). */
export class PlaybackQueue {
  private ids: string[];
  private repeat: RepeatMode = "off";
  private shuffled = false;

  constructor(private readonly database: NovaDatabase, initial: string[] = database.loadQueue()) {
    this.ids = [...initial];
  }

  items(resolve: (id: string) => Track | undefined): Track[] {
    return this.ids.flatMap((id) => {
      const track = resolve(id);
      return track ? [track] : [];
    });
  }

  enqueue(id: string): void {
    this.ids.push(id);
    this.persist();
  }

  dequeue(id: string): void {
    this.ids = this.ids.filter((queued) => queued !== id);
    this.persist();
  }

  move(from: number, to: number): void {
    if (from < 0 || from >= this.ids.length || to < 0 || to >= this.ids.length) return;
    const [id] = this.ids.splice(from, 1);
    if (id) this.ids.splice(to, 0, id);
    this.persist();
  }

  shuffle(): void {
    for (let i = this.ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.ids[i], this.ids[j]] = [this.ids[j]!, this.ids[i]!];
    }
    this.shuffled = true;
    this.persist();
  }

  setRepeat(mode: RepeatMode): void {
    this.repeat = mode;
  }

  state(): { ids: string[]; repeat: RepeatMode; shuffled: boolean } {
    return { ids: [...this.ids], repeat: this.repeat, shuffled: this.shuffled };
  }

  /** Fill with the most-played available tracks while avoiding duplicates. */
  smartQueue(candidates: Track[], playCount: (id: string) => number, limit = 25): void {
    const existing = new Set(this.ids);
    const ranked = [...candidates].sort((a, b) => playCount(b.id) - playCount(a.id) || b.addedAt.localeCompare(a.addedAt));
    for (const track of ranked) {
      if (this.ids.length >= limit) break;
      if (!existing.has(track.id)) {
        existing.add(track.id);
        this.ids.push(track.id);
      }
    }
    this.persist();
  }

  private persist(): void {
    this.database.saveQueue(this.ids);
  }
}
