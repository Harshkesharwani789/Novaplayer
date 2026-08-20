import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { reconcileLibrary } from "../src/library/reconcile";
import { NovaDatabase } from "../src/db/database";
import type { Library } from "../src/library/library";
import type { Track } from "../src/library/types";

function track(over: Partial<Track>): Track {
  return {
    id: "local:x",
    source: "local",
    sourceTrackId: "x",
    title: "Creep",
    artist: "Radiohead",
    filePath: "/nope.mp3",
    addedAt: "2024-01-01T00:00:00.000Z",
    ...over,
  };
}

function fakeLibrary(tracks: Track[]): Library {
  const map = new Map(tracks.map((t) => [t.id, t]));
  return {
    all: () => [...map.values()],
    remove: async (id: string) => {
      map.delete(id);
    },
  } as unknown as Library;
}

describe("reconcileLibrary never deletes the user's own files", () => {
  // Regression test for a data-loss bug: reconcile deduped on artist+title and
  // then `fs.rm`'d the loser. Tracks scanned from the user's own disk
  // (source "local") routinely share an artist+title without being duplicates
  // — a studio cut and a live version, or the same song on an album and on a
  // greatest-hits — so this silently destroyed original files the app never
  // created, at every boot and every 30s while browsing, with no undo.
  it("keeps both files when a local artist+title repeats across albums", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nova-safety-"));
    const studio = path.join(dir, "creep-studio.mp3");
    const live = path.join(dir, "creep-live.mp3");
    await fs.writeFile(studio, "studio audio");
    await fs.writeFile(live, "live audio");

    const library = fakeLibrary([
      track({ id: "local:a", album: "Pablo Honey", filePath: studio, addedAt: "2024-01-01T00:00:00.000Z" }),
      track({ id: "local:b", album: "Live at the Astoria", filePath: live, addedAt: "2024-06-01T00:00:00.000Z" }),
    ]);

    const result = await reconcileLibrary(library);

    expect(result.deletedFiles).toBe(0);
    expect(result.mergedDuplicates).toBe(0);
    // Both files must still be on disk.
    await expect(fs.access(studio)).resolves.toBeUndefined();
    await expect(fs.access(live)).resolves.toBeUndefined();
    expect(library.all()).toHaveLength(2);
  });

  it("still dedupes app-downloaded tracks, which is the actual feature", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nova-safety-"));
    const first = path.join(dir, "a.mp3");
    const second = path.join(dir, "b.mp3");
    await fs.writeFile(first, "audio");
    await fs.writeFile(second, "audio");

    const library = fakeLibrary([
      track({ id: "youtube:a", source: "youtube", filePath: first, addedAt: "2024-01-01T00:00:00.000Z" }),
      track({ id: "soundcloud:b", source: "soundcloud", filePath: second, addedAt: "2024-06-01T00:00:00.000Z" }),
    ]);

    const result = await reconcileLibrary(library);

    expect(result.deletedFiles).toBe(1);
    await expect(fs.access(first)).resolves.toBeUndefined();
    await expect(fs.access(second)).rejects.toThrow();
  });
});

describe("upsertTrack survives all three unique constraints", () => {
  const base = (over: Partial<Track>): Track => ({
    id: "local:fingerprint-one",
    source: "local",
    sourceTrackId: "fingerprint-one",
    title: "One More Time",
    artist: "Daft Punk",
    filePath: "/music/song.mp3",
    addedAt: "2026-08-19T00:00:00.000Z",
    fingerprint: "fingerprint-one",
    ...over,
  });

  // Regression test: the scanner derives a track id from a content
  // fingerprint, so re-tagging a file already in the library yields a NEW id
  // for the SAME file_path. `ON CONFLICT(id)` doesn't cover the `file_path`
  // UNIQUE index, so this threw and aborted the entire scan mid-walk —
  // leaving every file after it in the directory unindexed.
  it("re-tagging a file in place does not throw", () => {
    const db = NovaDatabase.memory();
    db.upsertTrack(base({}));

    expect(() =>
      db.upsertTrack(
        base({
          id: "local:fingerprint-two",
          sourceTrackId: "fingerprint-two",
          fingerprint: "fingerprint-two",
          title: "One More Time (Remastered)",
        }),
      ),
    ).not.toThrow();

    const rows = db.allTracks().filter((t) => t.filePath === "/music/song.mp3");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe("local:fingerprint-two");
    expect(rows[0]!.title).toBe("One More Time (Remastered)");
  });

  it("preserves play history across the re-key", () => {
    const db = NovaDatabase.memory();
    db.upsertTrack(base({}));
    db.recordPlay("local:fingerprint-one", 320, "2026-08-19T01:00:00.000Z");
    db.recordPlay("local:fingerprint-one", 320, "2026-08-19T02:00:00.000Z");

    db.upsertTrack(
      base({
        id: "local:fingerprint-two",
        sourceTrackId: "fingerprint-two",
        fingerprint: "fingerprint-two",
      }),
    );

    // History followed the track to its new id rather than being cascaded away.
    expect(db.analytics().totalListeningSec).toBe(640);
    expect(db.recentHistory().every((h) => h.id === "local:fingerprint-two")).toBe(true);
  });
});
