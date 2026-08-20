import readline from "node:readline";
import { execa } from "execa";
import { cookieArgs, getCookieBrowser, ffmpegPath, jsRuntimeArgs, toolEnv } from "../bin/binaries";
import { downloadStrategies, isStrategyFixable } from "./strategies";
import { ensureYtDlp } from "../bin/ytdlp-fetch";
import type { Config } from "../config/config";
import {
  audioFormatArgs,
  outputTemplate,
  outputTemplateFixed,
  outputTemplateInFolder,
} from "./args";
import { parseProgress, type DownloadProgress } from "./progress";

const META_FIELDS = [
  "id",
  "title",
  "track",
  "artist",
  "album",
  "duration",
  "uploader",
  "webpage_url",
  "playlist_title",
  "ext",
  "filepath",
] as const;

export interface TrackMeta {
  id: string;
  title: string;
  track?: string;
  artist?: string;
  album?: string;
  duration?: number;
  uploader?: string;
  webpage_url?: string;
  playlist_title?: string;
  ext?: string;
  filepath: string;
}

function val(s: string | undefined): string | undefined {
  return !s || s === "NA" ? undefined : s;
}

function parseMeta(line: string): TrackMeta | undefined {
  const parts = line.split("\t");
  const map: Partial<Record<(typeof META_FIELDS)[number], string>> = {};
  META_FIELDS.forEach((f, i) => {
    map[f] = val(parts[i + 1]);
  });
  if (!map.filepath || !map.id) return undefined;
  return {
    id: map.id,
    title: map.title ?? map.track ?? "Unknown",
    track: map.track,
    artist: map.artist,
    album: map.album,
    duration: map.duration ? Number(map.duration) : undefined,
    uploader: map.uploader,
    webpage_url: map.webpage_url,
    playlist_title: map.playlist_title,
    ext: map.ext,
    filepath: map.filepath,
  };
}

// ---------------------------------------------------------------------------
// Enumeration (listing playlists / tracks without downloading)
// ---------------------------------------------------------------------------

export interface YtEntry {
  id: string;
  title: string;
  url?: string;
  uploader?: string;
  duration?: number;
}

export interface YtCollection {
  id?: string;
  title?: string;
  uploader?: string;
  entries: YtEntry[];
}

function toEntry(e: Record<string, unknown>): YtEntry {
  return {
    id: String(e.id ?? ""),
    title: String(e.title ?? e.id ?? "Untitled"),
    url: (e.url as string) ?? (e.webpage_url as string) ?? undefined,
    uploader:
      (e.uploader as string) ?? (e.uploader_id as string) ?? undefined,
    duration: typeof e.duration === "number" ? e.duration : undefined,
  };
}

export interface EnumerateOptions {
  /** Flat listing (don't resolve each entry fully), fast. Default true. */
  flat?: boolean;
}

/**
 * List a collection (playlist / channel / likes feed) or a single item.
 *
 * This is the "paste a link" / "load a handle's playlists" path, which never
 * touches the download queue (and so never goes through its ensureTools()
 * gate) — it can run the moment the user pastes a URL, seconds after launch.
 * ensureYtDlp() here is what used to be missing: without it, a background
 * fetch that's still in flight (or one that quietly failed at boot) meant
 * this spawned a binary that plain didn't exist yet, surfacing a raw
 * "spawn ENOENT" instead of ever giving the download a real chance to finish.
 * ensureYtDlp() is memoized, so once it's resolved once this is instant.
 */
export async function enumerate(
  url: string,
  opts: EnumerateOptions = {},
): Promise<YtCollection> {
  const args = ["-J", "--ignore-config", "--no-warnings", "--encoding", "utf-8", ...jsRuntimeArgs(), ...cookieArgs()];
  if (opts.flat ?? true) args.push("--flat-playlist");
  args.push(url);

  const bin = await ensureYtDlp();
  let stdout: string;
  try {
    ({ stdout } = await execa(bin, args, { env: toolEnv() }));
  } catch (e) {
    // Surface yt-dlp's own "ERROR: ..." line instead of the raw execa dump.
    const err = e as { stderr?: string };
    const match = err.stderr?.match(/ERROR:\s*(.+)/);
    if (match) throw new Error(match[1]?.trim());
    throw e;
  }
  const data = JSON.parse(stdout) as Record<string, unknown>;
  const entries = data.entries;
  if (Array.isArray(entries)) {
    return {
      id: data.id as string | undefined,
      title: data.title as string | undefined,
      uploader: (data.uploader as string) ?? (data.uploader_id as string),
      entries: entries
        .filter((e): e is Record<string, unknown> => Boolean(e))
        .map(toEntry),
    };
  }
  return {
    id: data.id as string | undefined,
    title: data.title as string | undefined,
    entries: [toEntry(data)],
  };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

export interface DownloadParams {
  url: string;
  config: Config;
  /** Top-level folder name, e.g. "YouTube" | "SoundCloud" | "Spotify". */
  sourceLabel: string;
  /** Force the output filename stem (e.g. "Artist - Title"). For Spotify. */
  fixedStem?: string;
  /** Force the playlist folder name. For Spotify. */
  playlistName?: string;
  /** Normalized handle owning this collection (its folder segment). */
  owner?: string;
  /** Abort the download (kills the yt-dlp child process). */
  signal?: AbortSignal;
}

export interface DownloadResult {
  status: "downloaded" | "already" | "canceled" | "ratelimited";
  meta?: TrackMeta;
  /** Which request shape actually worked, when it wasn't the default. */
  strategy?: string;
}

/**
 * The strategy that last succeeded, remembered for the process lifetime.
 *
 * YouTube's refusals are consistent within a session, so once one shape works
 * the rest of the batch should start there instead of re-discovering it per
 * track.
 */
let preferredStrategyId: string | undefined;

/** Reset between runs; exported for tests. */
export function resetPreferredStrategy(): void {
  preferredStrategyId = undefined;
}

/**
 * Whether the platform is refusing because we aren't signed in — a bot check,
 * an age gate, or the bare 403 that YouTube returns once its anti-automation
 * heuristics trip.
 *
 * This is deliberately separate from {@link isRateLimitError}: the two look
 * similar in the logs but call for opposite advice. A rate limit clears on its
 * own if you wait, so "retry later" is right. An auth gate NEVER clears by
 * waiting — the request is missing a signed-in session, so retrying anonymously
 * fails identically forever. The only fix is to attach cookies, which is what
 * the message this drives tells the user to do.
 */
export function isAuthGateError(text: string): boolean {
  // Every alternative is a whole phrase. A bare "cookies" would match yt-dlp's
  // routine cookie-file chatter, and a bare "age" matches "message"/"usage" —
  // false positives here are worse than misses, since they send someone to
  // configure cookies for a failure cookies cannot fix.
  return /sign in to confirm|not a bot|confirm your age|age.?restricted|login required|LOGIN_REQUIRED|--cookies-from-browser|cookies for authentication|HTTP Error 403|403[: ]?Forbidden/i.test(
    text,
  );
}

/**
 * The one sentence the UI shows for an auth gate. Written as an instruction
 * rather than a diagnosis, because there IS an action that fixes it.
 */
export const AUTH_GATE_MESSAGE =
  "YouTube refused every request shape we tried; a signed-in session is the next thing to try (Settings → Browser cookies)";

/**
 * The most useful single line out of yt-dlp's stderr: its own `ERROR:` line if
 * there is one, otherwise the last non-empty line. Keeps the message we attach
 * to an auth-gate failure specific enough to debug without pasting the whole
 * extractor dump into a one-line UI row.
 */
export function firstMeaningfulError(lines: string[]): string {
  const explicit = lines.find((l) => /ERROR:/i.test(l));
  const chosen = explicit ?? [...lines].reverse().find((l) => l.trim());
  return (chosen ?? "no output").replace(/^\s*ERROR:\s*/i, "").trim().slice(0, 160);
}

/** Whether an error looks like the platform rate-limiting us (clears on its own). */
export function isRateLimitError(text: string): boolean {
  return /HTTP Error 429|Too Many Requests|rate.?limit|temporarily blocked/i.test(
    text,
  );
}

/** Download a single track with yt-dlp, streaming progress as it runs. */
export async function downloadTrack(
  params: DownloadParams,
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const { url, config, sourceLabel, fixedStem, playlistName, owner } = params;

  const outTpl = fixedStem
    ? outputTemplateFixed(
        config.libraryDir,
        sourceLabel,
        playlistName ?? "Singles",
        fixedStem,
      )
    : playlistName
      ? outputTemplateInFolder(config.libraryDir, sourceLabel, playlistName, owner)
      : outputTemplate(config.libraryDir, sourceLabel, owner);

  const progTpl =
    "download:SCPROG\t%(progress.status)s\t%(progress.downloaded_bytes)s\t%(progress.total_bytes)s\t%(progress.total_bytes_estimate)s\t%(progress.speed)s\t%(progress.eta)s";
  const metaTpl =
    "after_move:SCMETA\t" + META_FIELDS.map((f) => `%(${f})s`).join("\t");

  const baseArgs: string[] = [
    ...jsRuntimeArgs(),
    "--ffmpeg-location",
    ffmpegPath(),
    "--encoding",
    "utf-8",
    "--no-colors",
    "--newline",
    "--no-playlist",
    "--no-simulate",
    "--ignore-config",
    "--continue",
    // Gentle pacing so big batches are far less likely to get rate-limited.
    "--retries",
    "5",
    "--retry-sleep",
    "5",
    "--sleep-interval",
    "1",
    "--max-sleep-interval",
    "3",
    "--embed-metadata",
    "--embed-thumbnail",
    ...audioFormatArgs(),
    "-o",
    outTpl,
    "--progress-template",
    progTpl,
    "--print",
    metaTpl,
    url,
  ];

  // Belt-and-suspenders: the download queue already awaits ensureDownloadTools()
  // before calling this, but resolving it again here (memoized, so free once
  // settled) means downloadTrack() is correct even if ever called from
  // somewhere that isn't the queue.
  const bin = await ensureYtDlp();

  /** One yt-dlp invocation with a given strategy's extra arguments. */
  async function runOnce(extra: string[]): Promise<
    | { kind: "ok"; meta?: TrackMeta }
    | { kind: "canceled" }
    | { kind: "failed"; exitCode: number | undefined; errLines: string[] }
  > {
    // Strategy args go first so a `--extractor-args` from a retry cannot be
    // shadowed by anything in the base list.
    const subprocess = execa(bin, [...extra, ...baseArgs], {
      env: toolEnv(),
      buffer: false,
      reject: false,
      cancelSignal: params.signal,
    });

    let meta: TrackMeta | undefined;
    const errLines: string[] = [];
    const handle = (line: string): void => {
      if (line.startsWith("SCPROG\t")) {
        const p = parseProgress(line);
        if (p && onProgress) onProgress(p);
      } else if (line.startsWith("SCMETA\t")) {
        meta = parseMeta(line);
      } else if (line.trim()) {
        errLines.push(line);
      }
    };

    const rlOut = readline.createInterface({
      input: subprocess.stdout!,
      crlfDelay: Infinity,
    });
    const rlErr = readline.createInterface({
      input: subprocess.stderr!,
      crlfDelay: Infinity,
    });
    rlOut.on("line", handle);
    rlErr.on("line", handle);

    let result;
    try {
      result = await subprocess;
    } catch (e) {
      rlOut.close();
      rlErr.close();
      if (params.signal?.aborted) return { kind: "canceled" };
      throw e;
    }
    rlOut.close();
    rlErr.close();

    if (params.signal?.aborted) return { kind: "canceled" };
    if (result.exitCode !== 0) {
      return { kind: "failed", exitCode: result.exitCode ?? undefined, errLines };
    }
    return { kind: "ok", meta };
  }

  // Start from whatever last worked this session. On a 20-track playlist that
  // matters a lot: without it, every track would re-walk the failing strategies
  // from the top and the batch would take several times longer to do the same
  // work.
  const all = downloadStrategies(getCookieBrowser());
  const preferred = preferredStrategyId
    ? all.findIndex((s) => s.id === preferredStrategyId)
    : -1;
  const ordered = preferred > 0 ? [all[preferred]!, ...all.filter((_, i) => i !== preferred)] : all;

  let lastFailure: { exitCode: number | undefined; errLines: string[] } | undefined;

  for (const strategy of ordered) {
    const outcome = await runOnce(strategy.args);
    if (outcome.kind === "canceled") return { status: "canceled" };
    if (outcome.kind === "ok") {
      preferredStrategyId = strategy.id;
      if (outcome.meta) {
        onProgress?.({ status: "done", percent: 100 });
        return { status: "downloaded", meta: outcome.meta, strategy: strategy.label };
      }
      return { status: "already" };
    }

    lastFailure = outcome;
    const msg = outcome.errLines.slice(-20).join(" | ");
    // A rate limit is about pacing, not request shape — reshaping and
    // hammering again is exactly the wrong response, so stop and let the queue
    // park itself.
    if (isRateLimitError(msg)) return { status: "ratelimited" };
    if (!isStrategyFixable(msg)) break;
  }

  const msg = (lastFailure?.errLines ?? []).slice(-20).join(" | ");
  const detail = firstMeaningfulError(lastFailure?.errLines ?? []);
  if (isAuthGateError(msg)) {
    throw new Error(
      `${AUTH_GATE_MESSAGE} (${sourceLabel} said: ${detail})`,
    );
  }
  throw new Error(`yt-dlp failed (exit ${lastFailure?.exitCode ?? "?"}): ${msg}`);
}
