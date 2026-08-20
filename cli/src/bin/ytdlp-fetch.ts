import { promises as fs } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { binDir } from "../config/paths";
import { fetchResilient } from "../util/net";

const RELEASE_BASE = "https://github.com/yt-dlp/yt-dlp/releases/latest/download";

/** Name of the release asset that matches the current platform/arch. */
function assetName(): string {
  const { platform, arch } = process;
  if (platform === "win32") {
    return arch === "ia32" ? "yt-dlp_x86.exe" : "yt-dlp.exe";
  }
  if (platform === "darwin") {
    return "yt-dlp_macos"; // universal2 binary
  }
  // linux and other unix
  if (arch === "arm64") return "yt-dlp_linux_aarch64";
  if (arch === "arm") return "yt-dlp_linux_armv7l";
  return "yt-dlp_linux";
}

/** Local path where we store the yt-dlp binary. */
export function ytDlpPath(): string {
  const name = process.platform === "win32" ? "yt-dlp.exe" : "yt-dlp";
  return path.join(binDir, name);
}

/** Where a freshly downloaded update waits until the next launch promotes it. */
export function stagedYtDlpPath(): string {
  return `${ytDlpPath()}.new`;
}

/**
 * Download the latest release asset to `dest`. Writes to a temp file and
 * renames, so a crash mid-download can never leave a torn exe that later
 * looks installed.
 */
export async function downloadYtDlp(dest: string): Promise<void> {
  await fs.mkdir(binDir, { recursive: true });
  const url = `${RELEASE_BASE}/${assetName()}`;
  const res = await fetchResilient(url);
  if (!res.ok) {
    throw new Error(
      `Failed to download yt-dlp from ${url}: ${res.status} ${res.statusText}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const tmp = `${dest}.tmp`;
  await fs.writeFile(tmp, buf);
  if (process.platform !== "win32") {
    await fs.chmod(tmp, 0o755);
  }
  await fs.rename(tmp, dest);
}

/**
 * Promote a staged update to the live path. Runs before anything spawns the
 * binary, so this process never holds it; a second running NovaPlayer instance
 * can (EBUSY/EPERM on Windows), in which case the old binary stays and we
 * retry next launch. The rename dance keeps a working binary on disk at
 * every instant.
 */
export async function finalizeStagedYtDlp(): Promise<boolean> {
  const staged = stagedYtDlpPath();
  const dest = ytDlpPath();
  try {
    await fs.access(staged);
  } catch {
    return false; // nothing staged
  }
  const old = `${dest}.old`;
  // A leftover .old from a previous locked run; clearing it is best-effort.
  await fs.rm(old, { force: true }).catch(() => {});
  let hadCurrent = true;
  try {
    await fs.rename(dest, old);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      hadCurrent = false; // no live binary yet; the staged one becomes it
    } else {
      return false; // live exe is in use by another instance
    }
  }
  try {
    await fs.rename(staged, dest);
  } catch {
    if (hadCurrent) await fs.rename(old, dest).catch(() => {});
    return false;
  }
  await fs.rm(old, { force: true }).catch(() => {});
  return true;
}

async function probeBinary(dest: string): Promise<boolean> {
  try {
    await execa(dest, ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Download to `dest`, then check the binary actually runs. A failed probe
 * means a torn or antivirus-mangled exe: delete it and retry once before
 * giving up, so a bad first download can't masquerade as installed forever.
 * The download/probe/remove seams are injectable for tests.
 */
export async function downloadVerified(
  dest: string,
  download: (dest: string) => Promise<void> = downloadYtDlp,
  probe: (dest: string) => Promise<boolean> = probeBinary,
  remove: (p: string) => Promise<void> = async (p) => {
    await fs.rm(p, { force: true });
  },
): Promise<void> {
  await download(dest);
  if (await probe(dest)) return;
  await remove(dest);
  await download(dest);
  if (await probe(dest)) return;
  // Leave no torn exe behind: it would pass the exists check next launch.
  await remove(dest);
  throw new Error(
    "yt-dlp downloaded but won't start on this computer. Check that your antivirus isn't blocking NovaPlayer, then try again.",
  );
}

let inflight: Promise<string> | null = null;

/**
 * The binary ensureYtDlp() actually settled on, once it has.
 *
 * doEnsure() can legitimately return a *system* yt-dlp (Homebrew's, say)
 * instead of our own copy in binDir, so "the path we would download to" and
 * "the path we are really running" are not the same string. Anything that
 * needs to reason about the live binary — notably the freshness check — has to
 * ask for this one; using ytDlpPath() there silently described a file that may
 * not even exist.
 */
let resolvedYtDlp: string | null = null;

/** The yt-dlp actually in use, or null before the first ensure settles. */
export function resolvedYtDlpPath(): string | null {
  return resolvedYtDlp;
}

/**
 * Ensure yt-dlp is present, downloading it on first run. Returns its path.
 * Concurrent callers share one run, so the binary never downloads twice in
 * parallel; a failed run clears, so the next call retries fresh.
 */
export function ensureYtDlp(
  onStatus?: (msg: string) => void,
): Promise<string> {
  // `.catch`, deliberately, NOT `.finally`: a *successful* resolution must stay
  // cached for the process lifetime, while a failure clears so the next call
  // retries fresh. With `.finally` the cache was dropped on success too, so
  // every enumerate()/downloadTrack() re-ran the whole ensure — spawning a real
  // `yt-dlp --version` probe each time, and re-running finalizeStagedYtDlp()
  // (which promotes a staged binary on the assumption nothing is executing it)
  // while downloads were actively running that binary.
  inflight ??= doEnsure(onStatus)
    .then((p) => {
      resolvedYtDlp = p;
      return p;
    })
    .catch((e: unknown) => {
      inflight = null;
      throw e;
    });

  return inflight;
}

async function doEnsure(
  onStatus?: (msg: string) => void,
): Promise<string> {
  // 1. First check NovaPlayer's bundled/local yt-dlp.
  const local = ytDlpPath();

  await finalizeStagedYtDlp().catch(() => false);

  if (await probeBinary(local)) {
    return local;
  }

  // 2. Check the system-installed yt-dlp.
  const systemPaths = [
    "/opt/homebrew/bin/yt-dlp", // Apple Silicon Homebrew
    "/usr/local/bin/yt-dlp",    // Intel Homebrew
  ];

  for (const systemPath of systemPaths) {
    if (await probeBinary(systemPath)) {
      onStatus?.("Using system yt-dlp.");
      return systemPath;
    }
  }

  // 3. Fall back to downloading NovaPlayer's own copy.
  onStatus?.("yt-dlp not found. Downloading yt-dlp…");

  await downloadVerified(local);

  onStatus?.("yt-dlp ready.");

  return local;
}



