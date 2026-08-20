import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import type { Dirent } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import type { Library } from "./library";
import { libId, type Track } from "./types";

const AUDIO_EXTENSIONS = new Set([".aac", ".aiff", ".flac", ".m4a", ".mp3", ".oga", ".ogg", ".opus", ".wav", ".wma"]);

export interface ScanProgress {
  scanned: number;
  indexed: number;
  skipped: number;
  duplicates: number;
  file?: string;
}

export interface ScanResult extends ScanProgress {
  root: string;
}

interface ProbeTags {
  title?: string;
  artist?: string;
  album?: string;
  genre?: string;
}

interface ProbeResult {
  durationSec?: number;
  tags: ProbeTags;
  hasArtwork: boolean;
}

/** Recursively index a local collection without changing the music files. */
export async function scanLibrary(
  root: string,
  library: Library,
  onProgress?: (progress: ScanProgress) => void,
): Promise<ScanResult> {
  const fullRoot = path.resolve(root);
  const result: ScanResult = { root: fullRoot, scanned: 0, indexed: 0, skipped: 0, duplicates: 0 };
  for await (const filePath of walkAudioFiles(fullRoot)) {
    result.scanned++;
    result.file = filePath;
    const stat = await fs.stat(filePath);
    const modified = stat.mtime.toISOString();
    const current = library.findByPath(filePath);
    if (current?.fileSize === stat.size && current.fileModifiedAt === modified) {
      result.skipped++;
      onProgress?.(result);
      continue;
    }

    const fingerprint = await fingerprintFile(filePath, stat.size);
    const duplicate = library.findByFingerprint(fingerprint);
    if (duplicate && duplicate.filePath !== filePath) {
      result.duplicates++;
      onProgress?.(result);
      continue;
    }

    const probe = await probeAudio(filePath);
    const parsed = parseFilename(filePath);
    const sourceTrackId = fingerprint.slice(0, 24);
    const track: Track = {
      id: libId("local", sourceTrackId),
      source: "local",
      sourceTrackId,
      title: probe.tags.title || parsed.title,
      artist: probe.tags.artist || parsed.artist,
      album: probe.tags.album || path.basename(path.dirname(filePath)),
      genre: probe.tags.genre,
      durationSec: probe.durationSec,
      filePath,
      addedAt: current?.addedAt ?? new Date().toISOString(),
      fileSize: stat.size,
      fileModifiedAt: modified,
      fingerprint,
    };
    if (probe.hasArtwork) track.artworkPath = await extractArtwork(filePath, fingerprint);
    await library.upsert(track);
    result.indexed++;
    onProgress?.(result);
  }
  delete result.file;
  return result;
}

async function* walkAudioFiles(root: string): AsyncGenerator<string> {
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    throw new Error(`Cannot scan ${root}: ${error instanceof Error ? error.message : String(error)}`);
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const filePath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkAudioFiles(filePath);
    } else if (entry.isFile() && AUDIO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      yield filePath;
    }
  }
}

/** Hashes metadata plus the first 64 KiB: fast enough for large collections. */
export async function fingerprintFile(filePath: string, size: number): Promise<string> {
  const hash = createHash("sha256").update(`${size}:`);
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath, { end: 65_535 });
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export function parseFilename(filePath: string): { title: string; artist?: string } {
  const basename = path.basename(filePath, path.extname(filePath)).replace(/^\d+\s*[-_.]\s*/, "");
  const split = basename.split(/\s+-\s+/, 2).map((part) => part.trim());
  if (split.length === 2 && split[0] && split[1]) return { artist: split[0], title: split[1] };
  return { title: basename || "Untitled" };
}

async function probeAudio(filePath: string): Promise<ProbeResult> {
  try {
    const { stdout } = await execa("ffprobe", [
      "-v", "error", "-show_entries", "format=duration:format_tags=title,artist,album,genre:stream_disposition=attached_pic",
      "-of", "json", filePath,
    ]);
    const value = JSON.parse(stdout) as {
      format?: { duration?: string; tags?: Record<string, string> };
      streams?: Array<{ disposition?: { attached_pic?: number } }>;
    };
    const tags = value.format?.tags ?? {};
    const getTag = (name: string): string | undefined =>
      Object.entries(tags).find(([key]) => key.toLowerCase() === name)?.[1]?.trim() || undefined;
    const duration = Number(value.format?.duration);
    return {
      durationSec: Number.isFinite(duration) ? Math.round(duration) : undefined,
      tags: { title: getTag("title"), artist: getTag("artist"), album: getTag("album"), genre: getTag("genre") },
      hasArtwork: Boolean(value.streams?.some((stream) => stream.disposition?.attached_pic)),
    };
  } catch {
    // Metadata extraction is an enhancement; unsupported formats stay indexed.
    return { tags: {}, hasArtwork: false };
  }
}

async function extractArtwork(filePath: string, fingerprint: string): Promise<string | undefined> {
  const artworkDir = path.join(path.dirname(filePath), ".novaplayer-artwork");
  const target = path.join(artworkDir, `${fingerprint.slice(0, 16)}.jpg`);
  try {
    await fs.mkdir(artworkDir, { recursive: true });
    await execa("ffmpeg", ["-y", "-v", "error", "-i", filePath, "-map", "0:v:0", "-frames:v", "1", target]);
    return target;
  } catch {
    return undefined;
  }
}
