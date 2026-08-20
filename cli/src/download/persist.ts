import { promises as fs } from "node:fs";
import { legacyQueueFile } from "../config/paths";
import { NovaDatabase } from "../db/database";
import type { Library } from "../library/library";
import { libId, type SourceId } from "../library/types";
import { isSoundcloudTombstone } from "../sources/soundcloud";
import type { SourceTrack } from "../sources/types";
import type { QueueItem } from "./queue";

/** The unfinished part of a download we save to disk so it survives a restart. */
export interface PersistedItem {
  source: SourceId;
  sourceLabel: string;
  track: SourceTrack;
  status: "pending" | "paused";
  /** Spotify-only: carried so an unverified-match flag survives a restart. */
  unverifiedMatch?: boolean;
}

interface QueueSnapshot {
  version: 1;
  items: PersistedItem[];
}

/**
 * The unfinished items worth persisting. Downloading items become "pending"
 * (they resume from their .part next launch); done/skipped/error/canceled drop.
 */
export function snapshotItems(items: QueueItem[]): PersistedItem[] {
  const out: PersistedItem[] = [];
  for (const i of items) {
    if (i.status === "pending" || i.status === "downloading") {
      out.push({
        source: i.source,
        sourceLabel: i.sourceLabel,
        track: i.track,
        status: "pending",
        unverifiedMatch: i.unverifiedMatch,
      });
    } else if (i.status === "paused") {
      out.push({
        source: i.source,
        sourceLabel: i.sourceLabel,
        track: i.track,
        status: "paused",
        unverifiedMatch: i.unverifiedMatch,
      });
    }
  }
  return out;
}

/**
 * Drop anything that already landed in the library (finished before a crash),
 * plus SoundCloud tombstones persisted before the enumeration filter existed
 * (deleted tracks that 404 forever; restoring them re-manufactures failures).
 */
export function restorableItems(
  persisted: PersistedItem[],
  library: Library,
): PersistedItem[] {
  return persisted.filter(
    (p) =>
      !library.has(libId(p.source, p.track.id, p.track.owner)) &&
      !(
        p.source === "soundcloud" &&
        isSoundcloudTombstone({
          url: p.track.downloadUrl,
          title: p.track.title,
        })
      ),
  );
}

export async function saveQueue(items: QueueItem[]): Promise<void> {
  NovaDatabase.open().replaceDownloads(snapshotItems(items));
}

/** Synchronous save for app quit, so a partial download survives even on exit. */
export function saveQueueSync(items: QueueItem[]): void {
  NovaDatabase.open().replaceDownloads(snapshotItems(items));
}

export async function loadQueue(): Promise<PersistedItem[]> {
  const saved = NovaDatabase.open().downloads<PersistedItem>();
  if (saved.length > 0) return saved;
  try {
    const raw = await fs.readFile(legacyQueueFile, "utf8");
    const parsed = JSON.parse(raw) as QueueSnapshot;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.items)) {
      NovaDatabase.open().replaceDownloads(parsed.items);
      return parsed.items;
    }
  } catch {
    // missing or invalid: nothing to restore
  }
  return [];
}
