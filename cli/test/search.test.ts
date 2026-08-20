import { describe, expect, it } from "vitest";
import { fuzzyScore, searchTracks } from "../src/library/search";
import type { Track } from "../src/library/types";

const tracks: Track[] = [
  { id: "local:1", source: "local", sourceTrackId: "1", title: "Midnight City", artist: "M83", album: "Hurry Up, We're Dreaming", filePath: "/a.mp3", addedAt: "2026-08-19T00:00:00Z" },
  { id: "local:2", source: "local", sourceTrackId: "2", title: "City Lights", artist: "The Midnight", filePath: "/b.mp3", addedAt: "2026-08-18T00:00:00Z" },
];

describe("fuzzy library search", () => {
  it("rewards contiguous title matches", () => {
    expect(fuzzyScore("mid city", "Midnight City")).toBeGreaterThan(0);
    expect(searchTracks(tracks, "m83")[0]?.track.id).toBe("local:1");
  });

  it("searches album and artist fields", () => {
    expect(searchTracks(tracks, "dreaming")[0]?.track.id).toBe("local:1");
  });
});
