import os from "node:os";
import path from "node:path";
import envPaths from "env-paths";

export const APP_NAME = "novaplayer";

/** OS-appropriate config / data / cache directories. */
export const paths = envPaths(APP_NAME, { suffix: "" });

/** Directory where downloaded tool binaries (yt-dlp) are cached. */
export const binDir = path.join(paths.cache, "bin");

/** Default location for the downloaded music library. */
export const defaultLibraryDir = path.join(os.homedir(), "Music", "NovaPlayer");

/** Path to the JSON config file. */
export const configFile = path.join(paths.config, "config.json");

/** Path to the JSON library index. */
/** The local-first SQLite database. Kept beside the music library so it is
 * easy to back up with the collection and never leaves the user's machine. */
export const databaseFile = path.join(defaultLibraryDir, "novaplayer.db");

/** Pre-NovaPlayer JSON paths. They are read once by the migration layer only. */
const legacyPaths = envPaths(["sound", "cli"].join(""), { suffix: "" });
export const legacyLibraryIndexFile = path.join(legacyPaths.data, "library.json");
export const legacyHistoryFile = path.join(legacyPaths.data, "history.json");
export const legacyQueueFile = path.join(legacyPaths.data, "queue.json");
export const legacyConfigFile = path.join(legacyPaths.config, "config.json");

/** Persisted download queue, so pending/paused downloads survive a restart. */
/** Legacy yt-dlp download archive, removed on boot (library is now the source of truth). */
export const legacyArchiveFile = path.join(paths.data, "download-archive.txt");

/** Raw download-failure log (the UI shows short reasons; this keeps the data). */
export const downloadLogFile = path.join(paths.log, "downloads.log");
