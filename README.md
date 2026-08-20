# NovaPlayer

**NovaPlayer** is a terminal-first music player for managing and listening to a local music library.

It scans your music folder, stores metadata in SQLite, plays tracks through MPV, manages playlists and queues, and provides basic listening analytics.

## Features

* 🎵 Scan and index local music libraries
* 🔎 Fast fuzzy search
* ▶️ Play music through MPV
* 📂 Manage playlists and playback queues
* 🔄 Resume playback and recover queues
* 📊 View listening history and analytics
* 🖼️ Extract track metadata and artwork
* 🗄️ Store library data locally with SQLite
* 🎨 Terminal UI built with React + Ink

## Tech Stack

* **TypeScript**
* **React + Ink**
* **Node.js**
* **SQLite**
* **MPV**
* **FFmpeg**
* **Vitest**

## Supported Formats

```text
.mp3  .flac  .wav  .m4a  .aac
.ogg  .oga   .opus .aiff .wma
```

## Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/Harshkesharwani789/NovaPlayer.git
cd NovaPlayer
```

### 2. Install dependencies

```bash
npm install
```

### 3. Run in development

```bash
npm run dev
```

### 4. Build the project

```bash
npm run build
```

### 5. Run the built version

```bash
npm start
```

## CLI Commands

```bash
novaplayer
novaplayer scan ~/Music
novaplayer search "song name"
novaplayer --help
novaplayer --version
```

## Architecture

```text
Terminal UI
     ↓
State & Commands
     ↓
Playback / Queue
     ↓
SQLite Repository
     ↓
Local Music Library
```

The application is designed around a local-first architecture, keeping music data, playlists, history, and settings on the user's machine.

## Project Structure

```text
NovaPlayer/
├── cli/
│   ├── src/
│   ├── scripts/
│   └── package.json
├── package.json
├── tsconfig.json
├── tsup.config.ts
└── README.md
```

## Development Commands

```bash
npm run dev
npm run build
npm run start
npm run test
npm run typecheck
```

## Requirements

* Node.js 22.5+
* MPV for integrated playback
* FFmpeg for media metadata and artwork extraction

## License

MIT © Harsh Kesharwani
