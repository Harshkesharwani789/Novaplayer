import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { ensureYtDlp, ytDlpPath } from "./ytdlp-fetch";
import { ensureFfmpeg, ffmpegBinPath, ffprobeBinPath } from "./ffmpeg-fetch";
import { withToolsOnPath } from "../util/exec";
import { binDir } from "../config/paths";

export interface Binaries {
  ffmpeg: string;
  ffprobe: string;
  ytDlp: string;
  /** mpv path/command if available, else null (we fall back to the OS player). */
  mpv: string | null;
}

/** Where ffmpeg lives once fetched (pure path math; the fetch may still be in flight). */
export function ffmpegPath(): string {
  return ffmpegBinPath();
}

/** Where ffprobe lives once fetched (pure path math; the fetch may still be in flight). */
export function ffprobePath(): string {
  return ffprobeBinPath();
}

/**
 * Environment for spawning yt-dlp so it can find ffmpeg + ffprobe (both are
 * fetched into our binDir, so one PATH entry covers the pair).
 *
 * PYTHONUTF8/PYTHONIOENCODING force yt-dlp's piped stdout to UTF-8. Without
 * them, Python on Windows writes pipes in the legacy ANSI codepage with
 * errors=replace, so any character it can't encode (astral symbols, CJK)
 * comes back as "?": the printed final filepath then never matches the real
 * file on disk and titles from enumeration get mangled the same way.
 */
export function toolEnv(): NodeJS.ProcessEnv {
  return {
    ...withToolsOnPath(process.env, [binDir]),
    PYTHONUTF8: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

// The browser whose cookies yt-dlp should reuse. Held here, next to the other
// "how we invoke yt-dlp" helpers, and set from config at boot (and again when
// Settings changes it) so the many call sites that build yt-dlp arguments —
// none of which carry a Config — stay unchanged.
let cookieBrowser: string | undefined;

/** Point yt-dlp at a browser's cookie jar, or pass undefined to send none. */
export function setCookieBrowser(value: string | undefined): void {
  cookieBrowser = value?.trim() || undefined;
}

export function getCookieBrowser(): string | undefined {
  return cookieBrowser;
}

/**
 * Args that attach the user's existing browser session to a yt-dlp request.
 *
 * YouTube increasingly answers anonymous requests with a bot check that
 * surfaces as HTTP 403; no amount of retrying clears it, because the request
 * is missing a signed-in session rather than being rate-limited. Reusing the
 * cookie jar from a browser the user is already logged into is the supported
 * fix, and it means NovaPlayer never sees or stores a password itself.
 */
export function cookieArgs(): string[] {
  return cookieBrowser ? ["--cookies-from-browser", cookieBrowser] : [];
}

/**
 * Tell yt-dlp to use our own Node binary as its JavaScript runtime. The current
 * YouTube extractor needs a JS runtime and only enables Deno by default; since
 * NovaPlayer already runs on Node, so we reuse it and avoid asking the user to
 * install anything extra.
 */
export function jsRuntimeArgs(): string[] {
  return ["--js-runtimes", `node:${process.execPath}`];
}

async function findFile(
  dir: string,
  name: string,
  depth: number,
): Promise<string | null> {
  if (depth < 0) return null;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const ent of entries) {
    if (ent.isFile() && ent.name.toLowerCase() === name) {
      return path.join(dir, ent.name);
    }
  }
  for (const ent of entries) {
    if (ent.isDirectory()) {
      const r = await findFile(path.join(dir, ent.name), name, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

/** Common Windows mpv install locations (installer-based and portable). */
function windowsMpvCandidates(): string[] {
  if (process.platform !== "win32") return [];
  const out: string[] = [];
  const pf = process.env.ProgramFiles;
  const pf86 = process.env["ProgramFiles(x86)"];
  const local = process.env.LOCALAPPDATA;
  const home = os.homedir();
  if (pf) {
    out.push(path.join(pf, "MPV Player", "mpv.exe")); // shinchiro.mpv (winget)
    out.push(path.join(pf, "mpv", "mpv.exe"));
  }
  if (pf86) out.push(path.join(pf86, "MPV Player", "mpv.exe"));
  if (local) {
    out.push(path.join(local, "Programs", "MPV Player", "mpv.exe"));
    out.push(path.join(local, "Microsoft", "WinGet", "Links", "mpv.exe"));
  }
  out.push(path.join(home, "scoop", "apps", "mpv", "current", "mpv.exe"));
  out.push("C:\\ProgramData\\chocolatey\\bin\\mpv.exe");
  return out;
}

/** Scan winget's portable package dir for a bundled mpv.exe (Windows only). */
async function wingetPackagesMpv(): Promise<string | null> {
  if (process.platform !== "win32") return null;
  const local = process.env.LOCALAPPDATA;
  if (!local) return null;
  const pkgRoot = path.join(local, "Microsoft", "WinGet", "Packages");
  try {
    for (const entry of await fs.readdir(pkgRoot)) {
      if (entry.toLowerCase().startsWith("shinchiro.mpv")) {
        const found = await findFile(path.join(pkgRoot, entry), "mpv.exe", 3);
        if (found) return found;
      }
    }
  } catch {
    // package root missing
  }
  return null;
}

/** Find a usable mpv on PATH or a known install location, or null. */
export async function detectMpv(): Promise<string | null> {
  const tryRun = async (cmd: string): Promise<boolean> => {
    try {
      await execa(cmd, ["--version"], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };

  if (process.env.NOVAPLAYER_MPV && (await tryRun(process.env.NOVAPLAYER_MPV))) {
    return process.env.NOVAPLAYER_MPV;
  }

  const absolute = windowsMpvCandidates();
  const wg = await wingetPackagesMpv();
  if (wg) absolute.push(wg);
  for (const p of absolute) {
    try {
      await fs.access(p);
    } catch {
      continue;
    }
    if (await tryRun(p)) return p;
  }

  for (const cmd of ["mpv", "mpv.net"]) {
    if (await tryRun(cmd)) return cmd;
  }
  return null;
}

// ── mpv detection cache ─────────────────────────────────────────────────

function mpvCacheFile(): string {
  return path.join(binDir, "mpv-check.json");
}

async function readMpvCache(): Promise<string | null> {
  try {
    const raw = await fs.readFile(mpvCacheFile(), "utf8");
    const parsed = JSON.parse(raw) as { mpv?: unknown };
    return typeof parsed.mpv === "string" && parsed.mpv ? parsed.mpv : null;
  } catch {
    return null;
  }
}

/** Remember a positive detection so later launches skip the probe sweep. */
export async function writeMpvCache(mpv: string): Promise<void> {
  try {
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(mpvCacheFile(), JSON.stringify({ mpv }));
  } catch {
    // Cache only; detection still works without it.
  }
}

/**
 * How to act on the cached detection result. Pure, exported for tests:
 * NOVAPLAYER_MPV always wins with a full detect; a cached absolute path only
 * needs an fs.access (zero spawns); a cached bare command needs one
 * --version spawn; no cache means the full sweep.
 */
export function mpvResolutionStep(
  envMpv: string | undefined,
  cached: string | null,
): "detect" | "revalidate-path" | "revalidate-command" {
  if (envMpv || !cached) return "detect";
  return path.isAbsolute(cached) ? "revalidate-path" : "revalidate-command";
}

/**
 * Detection with the cache in front. Only positive results are ever cached:
 * a cached "missing" would silence the auto-install retry loop that keeps
 * playback healing itself on every launch.
 */
async function resolveMpv(): Promise<string | null> {
  const cached = await readMpvCache();
  const step = mpvResolutionStep(process.env.NOVAPLAYER_MPV, cached);
  if (cached && step === "revalidate-path") {
    try {
      await fs.access(cached);
      return cached;
    } catch {
      // The install moved or was removed; fall through to a full detect.
    }
  } else if (cached && step === "revalidate-command") {
    try {
      await execa(cached, ["--version"], { timeout: 5000 });
      return cached;
    } catch {
      // No longer on PATH; fall through to a full detect.
    }
  }
  const found = await detectMpv();
  // An env override stays transient: never let it linger in the cache.
  if (found && !process.env.NOVAPLAYER_MPV) await writeMpvCache(found);
  return found;
}

/**
 * Awaited immediately before a download actually spawns (yt-dlp needs its
 * binary present, ffmpeg needs its encoder). Both `ensure*` calls are
 * internally memoized and idempotent — once a tool is in place this resolves
 * instantly, so gating every download on it is free.
 */
export function ensureDownloadTools(
  onStatus?: (msg: string) => void,
): Promise<void> {
  return Promise.all([ensureYtDlp(onStatus), ensureFfmpeg(onStatus)]).then(
    () => undefined,
  );
}

/** Resolve every binary we depend on, fetching yt-dlp if needed. */
export async function ensureBinaries(
  onStatus?: (msg: string) => void,
): Promise<Binaries> {
  // yt-dlp and ffmpeg both ride in the background: a first-run fetch (or a
  // flaky/offline connection) must never block first paint or lock the whole
  // app behind a "setup failed" screen just because a download-only feature
  // isn't ready yet. Browsing and playing an existing library needs neither
  // binary. Each one gates only the feature that actually needs it —
  // "add a track" — via ensureDownloadTools(), awaited lazily by the
  // download queue right before a download spawns (see queue.ts).
  void ensureYtDlp(onStatus).catch(() => {});
  void ensureFfmpeg(onStatus).catch(() => {});
  const mpv = await resolveMpv();
  return {
    ffmpeg: ffmpegBinPath(),
    ffprobe: ffprobeBinPath(),
    ytDlp: ytDlpPath(),
    mpv,
  };
}
