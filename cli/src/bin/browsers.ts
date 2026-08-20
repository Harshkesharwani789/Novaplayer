import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Which browsers on this machine yt-dlp could read cookies from.
 *
 * YouTube refuses a growing share of anonymous requests with a bot check, and
 * the supported fix is to reuse a session the user is already signed into
 * (`--cookies-from-browser`). Asking someone to type a browser name is a bad
 * way to collect that: they can pick one they don't have installed, or misspell
 * it, and either way the retry fails for a second, unrelated reason. Detecting
 * what's actually on disk turns a free-text setting into a short, correct list.
 *
 * Detection is by profile directory rather than the cookie file itself: Chromium
 * moved its cookie DB from `Default/Cookies` to `Default/Network/Cookies` at
 * v96, and Firefox keeps one per randomly-named profile. The directory is the
 * part that stays put.
 */

/** yt-dlp's supported browser names, in the order we prefer to try them. */
export const KNOWN_BROWSERS = [
  "chrome",
  "brave",
  "edge",
  "firefox",
  "safari",
  "chromium",
  "opera",
  "vivaldi",
] as const;

export type BrowserName = (typeof KNOWN_BROWSERS)[number];

/**
 * Candidate data directories per browser and platform. A browser counts as
 * present when any one of its candidates exists.
 */
export function browserDataDirs(
  browser: BrowserName,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const mac = (...p: string[]) => path.join(home, "Library", ...p);
  const linux = (...p: string[]) => path.join(home, ...p);
  const local = env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
  const roaming = env.APPDATA ?? path.join(home, "AppData", "Roaming");

  if (platform === "darwin") {
    switch (browser) {
      case "chrome": return [mac("Application Support", "Google", "Chrome")];
      case "brave": return [mac("Application Support", "BraveSoftware", "Brave-Browser")];
      case "edge": return [mac("Application Support", "Microsoft Edge")];
      case "firefox": return [mac("Application Support", "Firefox")];
      // Safari's cookie jar is sandboxed; either location means it's usable.
      case "safari": return [mac("Containers", "com.apple.Safari"), mac("Cookies")];
      case "chromium": return [mac("Application Support", "Chromium")];
      case "opera": return [mac("Application Support", "com.operasoftware.Opera")];
      case "vivaldi": return [mac("Application Support", "Vivaldi")];
    }
  }
  if (platform === "win32") {
    switch (browser) {
      case "chrome": return [path.join(local, "Google", "Chrome", "User Data")];
      case "brave": return [path.join(local, "BraveSoftware", "Brave-Browser", "User Data")];
      case "edge": return [path.join(local, "Microsoft", "Edge", "User Data")];
      case "firefox": return [path.join(roaming, "Mozilla", "Firefox")];
      case "safari": return []; // not a thing on Windows
      case "chromium": return [path.join(local, "Chromium", "User Data")];
      case "opera": return [path.join(roaming, "Opera Software", "Opera Stable")];
      case "vivaldi": return [path.join(local, "Vivaldi", "User Data")];
    }
  }
  // linux and other unix
  switch (browser) {
    case "chrome": return [linux(".config", "google-chrome")];
    case "brave": return [linux(".config", "BraveSoftware", "Brave-Browser")];
    case "edge": return [linux(".config", "microsoft-edge")];
    case "firefox": return [linux(".mozilla", "firefox"), linux("snap", "firefox")];
    case "safari": return [];
    case "chromium": return [linux(".config", "chromium"), linux("snap", "chromium")];
    case "opera": return [linux(".config", "opera")];
    case "vivaldi": return [linux(".config", "vivaldi")];
  }
}

async function dirExists(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/** Browsers actually installed here, most-likely-first. Empty if none found. */
export async function detectBrowsers(): Promise<BrowserName[]> {
  const found = await Promise.all(
    KNOWN_BROWSERS.map(async (b) => {
      const dirs = browserDataDirs(b);
      for (const d of dirs) if (await dirExists(d)) return b;
      return null;
    }),
  );
  return found.filter((b): b is BrowserName => b !== null);
}

// Detection touches the filesystem, and the UI wants to render the result in a
// banner and a settings row on every frame. One lookup per process is plenty:
// browsers do not get installed mid-session in any way that matters here.
let cached: BrowserName[] | null = null;

export async function installedBrowsers(): Promise<BrowserName[]> {
  cached ??= await detectBrowsers();
  return cached;
}

/** Synchronous read of the cached result, for render paths. */
export function installedBrowsersSync(): BrowserName[] {
  return cached ?? [];
}

/** Warm the cache at boot so render paths have an answer without awaiting. */
export async function primeBrowserDetection(): Promise<void> {
  await installedBrowsers();
}

/** The browser to suggest first, or undefined when nothing was detected. */
export function suggestedBrowser(): BrowserName | undefined {
  return installedBrowsersSync()[0];
}

/**
 * Advance the cookie setting through the browsers this machine actually has,
 * ending back at "off" (undefined). Falls back to the full supported list when
 * detection found nothing, so the setting is never a dead end.
 */
export function nextBrowser(
  current: string | undefined,
  available: readonly string[] = installedBrowsersSync(),
): string | undefined {
  const list = available.length > 0 ? available : KNOWN_BROWSERS;
  if (!current) return list[0];
  const at = list.indexOf(current);
  // An unrecognised value (hand-edited config) cycles back to off rather than
  // sticking, so the toggle can always reach a known-good state.
  if (at < 0 || at === list.length - 1) return undefined;
  return list[at + 1];
}
