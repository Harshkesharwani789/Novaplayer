<div align="center">

<img src="https://raw.githubusercontent.com/Harshkesharwani789/Novaplayer/main/cli/preview/welcome.svg" alt="NovaPlayer's first run: the wordmark, the pitch, and the source picker" width="832">

</div>

## Own your music

NovaPlayer keeps your music on your own machine and plays it from your terminal.
Point it at the audio files you already have, or pull in a YouTube, SoundCloud or
Spotify library — either way every song ends up as a real file on your own drive,
yours to keep and playable with the network off.

```bash
npx novaplayer
```

That is the whole install. NovaPlayer fetches the few tools it needs on first run.

## Get started

You only have to do this once.

1. **Install Node.js** from [nodejs.org](https://nodejs.org) — version 22 or newer.
   It is the one piece of software NovaPlayer runs on.
2. **Open your terminal.** On a Mac press <kbd>Cmd</kbd> + <kbd>Space</kbd>, type
   `terminal`, press Enter. On Windows press the Windows key, type `terminal`,
   press Enter.
3. **Run it:**

   ```bash
   npx novaplayer
   ```

From there NovaPlayer takes over. It downloads `yt-dlp` and `ffmpeg` into its own
cache the first time it needs them — nothing is installed system-wide, and nothing
is left behind that you did not ask for.

## The first run

NovaPlayer shows you where your music will live: a dedicated folder inside your
Music directory, so you always know where your files are.

Then it asks where your music comes from. Point it at a folder you already have,
or pick **YouTube**, **SoundCloud** or **Spotify** and give it a username, a
playlist link, an album or a single track. Downloading starts straight away, and
you can begin listening while the rest of the library finishes.

## Your library, kept in order

<div align="center">

<img src="https://raw.githubusercontent.com/Harshkesharwani789/Novaplayer/main/cli/preview/library.svg" alt="The library view: sidebar, tracks grouped by source, and the now-playing bar" width="832">

</div>

Everything you add is indexed into a single SQLite file that sits next to the
music itself — so backing up the folder backs up the library with it.

- **Scans what you already own.** `novaplayer scan ~/Music` walks a folder and
  reads the tags and embedded artwork out of every file. It handles mp3, flac,
  m4a, opus, wav, ogg, aac, aiff, oga and wma.
- **Rescans are quick.** Unchanged files are skipped by comparing size and
  modified time, so a second scan of a large collection takes seconds.
- **Keeps up when files move.** Tracks that are renamed, moved or deleted behind
  its back are reconciled rather than left as dead rows.
- **Groups by where it came from.** Imported collections keep their source and
  their owner, stored per handle so two accounts never collide on disk.

## Finding and playing

Search is fuzzy: the letters only have to appear in order, so `mdnght` finds
*Midnight City*. Matches rank higher when they are exact, at the start of a word,
or in the title rather than the album.

Playback runs through **mpv**, driven over a local socket. One long-lived process
handles every track, which is why pause genuinely pauses — press it again and the
song continues from exactly where it stopped, instead of starting over. Your queue
is written to disk, so closing NovaPlayer and reopening it puts you back where you
were.

If mpv is not installed, NovaPlayer says so and hands tracks to your default
player rather than offering transport controls it cannot honour.

## Every key

<div align="center">

<img src="https://raw.githubusercontent.com/Harshkesharwani789/Novaplayer/main/cli/preview/keys.svg" alt="The full keyboard cheatsheet, opened with ?" width="832">

</div>

Press <kbd>?</kbd> at any time for this list. The essentials:

| Key | Does |
| --- | --- |
| <kbd>space</kbd> | Play / pause |
| <kbd>←</kbd> <kbd>→</kbd> | Seek 15 seconds |
| <kbd>n</kbd> <kbd>p</kbd> | Next / previous |
| <kbd>s</kbd> <kbd>r</kbd> | Shuffle / repeat |
| <kbd>/</kbd> | Search your library |
| <kbd>ctrl</kbd>+<kbd>k</kbd> | Command palette |
| <kbd>1</kbd>–<kbd>6</kbd> | Jump to a section |
| <kbd>q</kbd> | Quit |

## What you actually listen to

Every play is recorded locally, and the analytics view turns that into total
listening time plus your top artists, albums, tracks and genres. It is computed
from your own database on your own machine. There is no account to make and no
server to send it to, so the numbers are yours and nobody else's.

## Commands

```bash
novaplayer                  # open the dashboard
novaplayer scan ~/Music     # index a folder incrementally
novaplayer search "creep"   # fuzzy-search your library
novaplayer <link>           # queue a YouTube / SoundCloud / Spotify link
novaplayer --version
```

## Where things live

| What | Where |
| --- | --- |
| Music | `~/Music/NovaPlayer` (configurable) |
| Database | `novaplayer.db`, beside the music |
| Config, cache, logs | your operating system's standard directories |

No dotfile dumped in your home folder, no telemetry, no account, and no network
needed once a song is on disk.

## Using the library from your own code

The same repository class the app uses is exported, so you can read the library
without going near the terminal UI:

```ts
import { Library } from "novaplayer/library";

const library = await Library.load();
console.log(library.all().length, "tracks");
console.log(library.search("radiohead"));
```

These entry points ship as TypeScript source, so your build needs to transpile
dependencies (in Next.js, via `transpilePackages`).

## Requirements

- **Node.js 22+** — required.
- **mpv** — optional, but needed for in-terminal playback and transport controls.
- **yt-dlp** and **ffmpeg** — fetched automatically when first needed.

## Notes

The screenshots above are rendered from the real interface with placeholder
track names, so the layout is genuine even though the songs in it are not.

Source and issues: [https://github.com/Harshkesharwani789/Novaplayer](https://github.com/Harshkesharwani789/Novaplayer) · MIT
