import { promises as fs } from "node:fs";
import path from "node:path";
import { parseSpotifyInput } from "../sources/spotify/public";
import { normalizeSpotifyHandle } from "../sources/spotify/handle";
import { configFile, defaultLibraryDir, legacyConfigFile } from "./paths";
import { resolveDefaultLibraryDir } from "./music-dir";

export interface Config {
  /** Where downloaded audio files live. */
  libraryDir: string;
  /** The user's YouTube handle (public playlists). */
  youtubeHandle?: string;
  /** The user's SoundCloud handle (public likes + sets). */
  soundcloudHandle?: string;
  /** The user's Spotify username (public playlists on their profile). */
  spotifyHandle?: string;
  /** @deprecated Migrated to spotifyHandle when it was a user id. */
  spotifyProfile?: string;
  /** Whether the first-run wizard has completed. */
  firstRunComplete: boolean;
  /** Check for yt-dlp updates at every launch (staged, applied when idle). */
  ytdlpAutoUpdate?: boolean;
  /**
   * Browser whose cookie jar yt-dlp should reuse
   * (`--cookies-from-browser`). Undefined means "send no cookies" — the
   * default, and correct for SoundCloud and most links.
   *
   * YouTube gates a growing share of requests behind a bot check ("Sign in to
   * confirm you're not a bot"), which surfaces as HTTP 403 on an anonymous
   * download. Retrying anonymously never clears it: the request has to carry a
   * real signed-in session. Borrowing the one already in the user's browser is
   * the only way to do that without NovaPlayer ever handling a password.
   */
  cookiesFromBrowser?: string;
}

/** Drop deprecated keys before returning config or writing it to disk. */
export function stripDeprecatedConfig(config: Config): Config {
  const { spotifyProfile: _, ...rest } = config;
  return rest;
}

export const defaultConfig: Config = {
  libraryDir: defaultLibraryDir,
  youtubeHandle: undefined,
  soundcloudHandle: undefined,
  spotifyHandle: undefined,
  spotifyProfile: undefined,
  firstRunComplete: false,
  ytdlpAutoUpdate: true,
};

export async function loadConfig(): Promise<Config> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile, "utf8");
  } catch {
    // Preserve a prior setup while moving NovaPlayer's own music
    // library and database to ~/Music/NovaPlayer. The old JSON file is never
    // modified, so a rollback stays safe.
    try {
      raw = await fs.readFile(legacyConfigFile, "utf8");
    } catch {
      // True first run: ask the OS where Music really lives.
      return { ...defaultConfig, libraryDir: await resolveDefaultLibraryDir() };
    }
  }
  try {
    const parsed = JSON.parse(raw) as Partial<Config>;
    const cfg = { ...defaultConfig, ...parsed };
    if (!cfg.spotifyHandle && parsed.spotifyProfile) {
      const ref = parseSpotifyInput(parsed.spotifyProfile);
      if (ref.type === "user") {
        cfg.spotifyHandle = normalizeSpotifyHandle(parsed.spotifyProfile);
      }
    }
    return stripDeprecatedConfig(cfg);
  } catch {
    return { ...defaultConfig };
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await fs.mkdir(path.dirname(configFile), { recursive: true });
  await fs.writeFile(
    configFile,
    JSON.stringify(stripDeprecatedConfig(config), null, 2),
    "utf8",
  );
  // Pre-create the music folder so downloads and "open folder" always land
  // somewhere real; a bad path must never break a config save.
  await fs.mkdir(config.libraryDir, { recursive: true }).catch(() => {});
}
