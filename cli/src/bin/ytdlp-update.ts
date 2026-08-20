// Freshness check for the yt-dlp binary, run at every launch. Platforms
// change their APIs out from under extractors and upstream ships fixes within
// days, so a binary that never updates quietly turns every download from one
// source into "failed" (exactly what a stale SoundCloud extractor did). The
// check is silent and async: a newer binary is staged next to the live one,
// then promoted the moment nothing is running it (right away on an idle boot,
// otherwise on the next launch).

import { promises as fs } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { toolEnv } from "./binaries";
import {
  downloadYtDlp,
  ensureYtDlp,
  resolvedYtDlpPath,
  stagedYtDlpPath,
} from "./ytdlp-fetch";
import { binDir } from "../config/paths";
import type { FetchImpl } from "../util/net";

/** Following this redirect reveals the latest tag (no GitHub API quota). */
export const LATEST_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest";

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface YtDlpCheckStamp {
  checkedAt: number;
  latest?: string;
}

export function stampPath(): string {
  return path.join(binDir, "yt-dlp-check.json");
}

/** Extract the version from a releases/tag/<version> redirect Location. */
export function parseLatestFromLocation(
  location: string | null,
): string | null {
  if (!location) return null;
  const m = location.match(/\/tag\/([^/?#]+)\/?$/);
  return m ? decodeURIComponent(m[1]!) : null;
}

/**
 * Dot-segment numeric compare (yt-dlp versions are dates: 2026.06.09, with a
 * fourth segment on nightlies). A null/garbled local version means the binary
 * can't even print --version, so it counts as out of date and a fresh
 * download heals it. Garbage in `latest` never triggers a download.
 */
export function isNewerVersion(
  latest: string,
  current: string | null,
): boolean {
  const parse = (v: string) => v.split(".").map((s) => Number(s));
  const a = parse(latest);
  if (a.some((n) => Number.isNaN(n))) return false;
  if (current === null) return true;
  const b = parse(current);
  if (b.some((n) => Number.isNaN(n))) return true;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** True when the stamp is missing, malformed, or older than the daily interval. */
export function shouldCheck(
  stamp: YtDlpCheckStamp | null,
  now = Date.now(),
): boolean {
  if (!stamp || typeof stamp.checkedAt !== "number") return true;
  if (stamp.checkedAt > now) return true;
  return now - stamp.checkedAt >= UPDATE_CHECK_INTERVAL_MS;
}

export async function readStamp(): Promise<YtDlpCheckStamp | null> {
  try {
    const raw = await fs.readFile(stampPath(), "utf8");
    const parsed = JSON.parse(raw) as YtDlpCheckStamp;
    if (typeof parsed.checkedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeStamp(latest: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  const stamp: YtDlpCheckStamp = { checkedAt: Date.now(), latest };
  await fs.writeFile(stampPath(), JSON.stringify(stamp));
}

/** Resolve the latest release version, or null on any network hiccup. */
export async function fetchLatestVersion(
  fetchImpl: FetchImpl = fetch as FetchImpl,
): Promise<string | null> {
  try {
    const res = await fetchImpl(LATEST_URL, {
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return parseLatestFromLocation(res.headers.get("location"));
  } catch {
    return null;
  }
}

/**
 * What the yt-dlp we actually run reports, or null if it can't even say.
 *
 * This has to be the *resolved* binary, not ytDlpPath(). ensureYtDlp() falls
 * back to a system install (Homebrew's, typically) when binDir has no copy of
 * its own, and on such a machine ytDlpPath() points at a file that does not
 * exist — so the freshness check compared the latest release against nothing,
 * every launch, and the stale extractor the downloads were actually using was
 * never even looked at. That is the state this was found in: a six-week-old
 * system yt-dlp serving every download while the updater reported no work to
 * do.
 *
 * Note that healing a stale *system* binary never touches it. We download our
 * own copy into binDir, which doEnsure() prefers from the next launch onward,
 * so a Homebrew-managed install is left exactly as the user's package manager
 * put it.
 */
export async function localYtDlpVersion(): Promise<string | null> {
  let target = resolvedYtDlpPath();
  if (!target) {
    // Boot races the background ensure; joining it is free once memoized and
    // avoids probing a path nothing has settled on yet.
    try {
      target = await ensureYtDlp();
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execa(target, ["--version"], {
      env: toolEnv(),
      timeout: 15_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The per-launch background check: stage the newest binary. Returns true when
 * an update is staged and ready to promote. Offline or any failure means
 * false; the app keeps running on the cached binary.
 */
export async function maybeUpdateYtDlp(
  fetchImpl: FetchImpl = fetch as FetchImpl,
): Promise<boolean> {
  const stamp = await readStamp();
  if (!shouldCheck(stamp)) return false;

  const latest = await fetchLatestVersion(fetchImpl);
  if (!latest) return false;

  const current = await localYtDlpVersion();
  if (!isNewerVersion(latest, current)) {
    await writeStamp(latest);
    return false;
  }

  await downloadYtDlp(stagedYtDlpPath());
  await writeStamp(latest);
  return true;
}
