# NovaPlayer architecture

## Design goals

NovaPlayer treats the local collection as the source of truth. A network source can enrich a library, but it must not be required to play, search, organize, or understand music.

## Layers

1. **Terminal UI** — React and Ink render browse, analytics, settings, and command-palette surfaces.
2. **Web UI** — a Next.js app (`web/`) with two independent surfaces: a static marketing/showcase page at `/`, and a real player at `/player` that lists, searches, and streams the local library.
3. **State layer** — `Library`, `PlayHistory`, and `PlaybackQueue` expose stable APIs to the terminal UI; the web player has its own client-side `PlayerProvider` that owns audio element state (see below).
4. **Media layer** — MPV runs out of process and communicates through IPC for the terminal app; the process cannot block Ink rendering. The web player instead uses one persistent `HTMLAudioElement` and Next.js API routes that stream files with HTTP Range support.
5. **Repository layer** — `NovaDatabase` owns migrations and parameterized SQLite access; `Library` is the stable façade over it.
6. **Filesystem layer** — the scanner walks audio folders, fingerprints files, extracts available tags/artwork, and upserts only changed records.

## Sharing the library between two frontends

The web player does not reimplement library access. `cli/package.json` declares subpath exports (`novaplayer/library`, `novaplayer/types`) pointing at the CLI's own TypeScript source; `web/package.json` depends on `novaplayer` as an npm workspace package, and `web/next.config.ts` sets `transpilePackages: ["novaplayer"]` so Next can compile that source directly. The result: `web/src/app/api/tracks/route.ts` calls `Library.load()` — the identical class the terminal app uses — instead of a parallel reimplementation. One repository layer, two UIs on top of it, no duplicated SQL or duplicated `Track` shape.

The web player owns exactly one thing the terminal app doesn't need: an HTTP layer for audio bytes (`web/src/app/api/tracks/[id]/stream/route.ts`), because a browser's `<audio>` element can't open a local file path the way mpv can.

## Reliability decisions

- SQLite uses foreign keys and WAL mode.
- The scanner fingerprints the first 64 KiB plus size so duplicate checks do not read a whole collection.
- File size and modified time make repeated scans incremental.
- The download queue and the playback queue are separate: a transfer cannot corrupt listening order.
- The previous JSON data is only read during migration and is left intact as a recovery copy.
- The stream API route supports HTTP Range requests (206 Partial Content) so seeking in the web player doesn't require re-downloading the file from byte zero.
- Both playback engines (`Playback` for mpv, `PlayerProvider` for the browser) hold exactly one long-lived audio handle for the life of a session — a process or an `HTMLAudioElement` — and send it commands rather than recreating it per track. That single decision is what makes pause/resume actually pause and resume instead of restarting.

## Data flow

```text
scan ~/Music → scanner → metadata / fingerprint → Library → SQLite tracks
play track (terminal) → Playback → MPV IPC → PlayHistory → SQLite history
play track (web)      → PlayerProvider → HTMLAudioElement → GET /api/tracks/:id/stream (Range) → same file on disk
Ctrl+K       → command palette → Library / Playback / scanner / analytics
```
