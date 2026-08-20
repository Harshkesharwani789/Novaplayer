# NovaPlayer

NovaPlayer is a terminal-first music workstation for people who keep music locally. It indexes a collection, plays files through MPV, manages playlists and queues, and turns listening history into local analytics.

It is not a music-download product. Source imports remain an optional compatibility workflow; the local library is the primary experience.

## What it does

- Scan a folder recursively with `novaplayer scan ~/Music`
- Extract available metadata and embedded artwork through FFmpeg tooling
- Detect unchanged files and content duplicates during incremental scans
- Store the library, playlists, history, download recovery state, settings, and playback queue in SQLite
- Fuzzy-search title, artist, album, and playlist fields from `/`, `search`, or `Ctrl+K`
- Play through MPV IPC with shuffle, repeat, queue recovery, and media controls
- Show terminal analytics for listening time, artists, albums, tracks, and genres

## Quick start (local development)

This project is **not yet published to npm**, so `npx novaplayer` only works once you've built it locally, or after a future publish. Nothing is broken here — it's simply not on the registry yet, and this README won't pretend otherwise.

```bash
git clone https://github.com/Harshkesharwani789/NovaPlayer.git
cd NovaPlayer
npm install
npm run build       # produces cli/dist/index.js — the actual `bin` target
npm install          # run install once more so npm links the "novaplayer" bin now that it exists
npx novaplayer       # runs your local build
```

(That second `npm install` matters — see [Troubleshooting](#troubleshooting) for why.)

Or skip `npx` entirely:

```bash
npm run dev            # tsx src/index.tsx — fastest inner loop, no build step
npm run build && npm start   # build once, then run the compiled binary like a real install
```

Once this is published (see [Publishing](#publishing)), a real install anywhere will just be:

```bash
npx novaplayer
# or
npm install -g novaplayer
novaplayer scan ~/Music
novaplayer
```

NovaPlayer requires Node.js 22.5+ (it uses Node's built-in `node:sqlite`). For in-terminal playback, install [MPV](https://mpv.io/); the app falls back to the system default player when it is unavailable.

## Commands

```text
novaplayer                  Open the workstation
novaplayer scan ~/Music     Incrementally index a local library
novaplayer search <text>    Fuzzy-search the indexed library
novaplayer <link>           Optional supported-source import
novaplayer --version        Print the version
novaplayer --help           Show command help
```

## Supported audio formats

`.aac` `.aiff` `.flac` `.m4a` `.mp3` `.oga` `.ogg` `.opus` `.wav` `.wma`

Anything else is skipped by the scanner. Files it does index but can't read tags/duration from (corrupted or unusual encodes) are still indexed, under a filename-derived title, rather than dropped.

## Architecture

```text
                 Terminal UI (React + Ink)
                             ↓
                   State and command layer
                             ↓
          Playback engine (MPV IPC) ── Queue engine
                             ↓
                  SQLite repository layer
                             ↓
         Local filesystem scanner and media files
```

The repository layer is deliberately narrow. The UI reads `Library`, `PlayHistory`, and `PlaybackQueue` APIs rather than talking to SQL directly, which keeps the terminal interface responsive while database migrations, scanning, and recovery stay testable. The same `Library` class is exported from the package (`novaplayer/library`), so other tools can read the library without reimplementing how it is stored.

Detailed design notes live in [ARCHITECTURE.md](ARCHITECTURE.md), with upcoming work in [ROADMAP.md](ROADMAP.md). A full engineering write-up — architecture, code walkthrough, the hardest bugs, and interview prep — lives in [PROJECT_EXPLANATION.md](PROJECT_EXPLANATION.md).

## Database

The database is created at:

```text
~/Music/NovaPlayer/novaplayer.db
```

| Table | Responsibility |
| --- | --- |
| `tracks`, `artists`, `albums` | Indexed local-library metadata |
| `playlists`, `playlist_tracks` | User playlist membership and ordering |
| `history` | Playback events for recent activity and analytics |
| `downloads` | Recoverable optional-source work |
| `settings` | Application preferences |
| `playback_queue` | Queue order recovered after restart |

On the first run, NovaPlayer imports compatible legacy JSON files when present and leaves them untouched as a backup.

## Development

```bash
npm install                 # install dependencies
npm run dev                 # terminal app, dev mode (tsx, no build step)
npm run build               # bundle to cli/dist/index.js
npm run start               # run the built binary
npm run test                # test suite (vitest)
npm run typecheck           # typecheck
npm run previews            # regenerate the README's SVG screenshots
```

### README screenshots

The images in [cli/README.md](cli/README.md) are SVGs rendered from the real
interface by `npm run previews`, using placeholder track names from
`cli/scripts/fake-data.ts` — the layout is genuine, the songs in it are not.
Re-run that command after any UI change so the package page cannot drift from
what the app actually looks like, and commit the result: npm serves those images
from the GitHub repository, so they only appear on the package page once they
are pushed.

## Publishing

To make `npx novaplayer` and `npm install -g novaplayer` work for anyone, the `cli` package needs to be published:

```bash
cd cli
npm run build
npm publish
```

This has not been done yet (see [ROADMAP.md](ROADMAP.md)). The name `novaplayer` was available on the npm registry as of this writing.

## Troubleshooting

- **`npx novaplayer` fails with a 404 / "not found"** — npm could not reach the registry, or you are on a version of the package that predates publishing. From a local checkout, use the development steps above instead.
- **`(node:...) ExperimentalWarning: SQLite is an experimental feature...`** — expected and harmless. It's Node flagging that `node:sqlite` (the local database driver) is still an experimental API; it doesn't affect functionality.
- **"Player not ready" in the now-playing bar** — MPV isn't installed. NovaPlayer still opens files in your system's default player; install MPV for full transport controls (seek, volume, pause/resume from within the app).
- **`novaplayer scan <dir>` fails** — the directory doesn't exist or isn't readable; the error message names the exact path and reason instead of a stack trace.
- **Fresh clone, `npx novaplayer` still can't find the binary after building** — npm workspaces only link a workspace's `bin` into the root `node_modules/.bin` if the target file already exists at `npm install` time. If you ran `npm install` before ever building, run `npm install` a second time after `npm run build`.

## Future improvements

See [ROADMAP.md](ROADMAP.md) and the "Future improvements" section of [PROJECT_EXPLANATION.md](PROJECT_EXPLANATION.md).

## License

MIT © Harsh Kesharwani
# NovaPlayer
