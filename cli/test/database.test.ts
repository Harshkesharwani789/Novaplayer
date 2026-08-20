import { describe, expect, it } from "vitest";
import { NovaDatabase } from "../src/db/database";
import type { Track } from "../src/library/types";

function track(id = "local:one"): Track {
  return {
    id,
    source: "local",
    sourceTrackId: id.slice(6),
    title: "One More Time",
    artist: "Daft Punk",
    album: "Discovery",
    genre: "Electronic",
    durationSec: 321,
    filePath: `/music/${id}.mp3`,
    addedAt: "2026-08-19T00:00:00.000Z",
    fingerprint: `hash-${id}`,
  };
}

describe("NovaDatabase", () => {
  it("stores tracks, listening history, and analytics in SQLite", () => {
    const db = NovaDatabase.memory();
    const item = track();
    db.upsertTrack(item);
    db.recordPlay(item.id, item.durationSec, "2026-08-19T01:00:00.000Z");
    db.recordPlay(item.id, item.durationSec, "2026-08-19T02:00:00.000Z");

    expect(db.getTrack(item.id)?.artist).toBe("Daft Punk");
    expect(db.analytics().totalListeningSec).toBe(642);
    expect(db.analytics().topArtists[0]).toEqual({ name: "Daft Punk", plays: 2 });
  });

  it("persists the playback queue order", () => {
    const db = NovaDatabase.memory();
    db.upsertTrack(track("local:one"));
    db.upsertTrack(track("local:two"));
    db.saveQueue(["local:two", "local:one"]);
    expect(db.loadQueue()).toEqual(["local:two", "local:one"]);
  });

  it("creates named playlists in the relational schema", () => {
    const db = NovaDatabase.memory();
    expect(db.createPlaylist("Night Drive")).toMatch(/^playlist:/);
    expect(() => db.createPlaylist("night drive")).toThrow();
  });
});
