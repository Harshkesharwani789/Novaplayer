import { describe, expect, it } from "vitest";
import { NovaDatabase } from "../src/db/database";
import { PlaybackQueue } from "../src/player/queue-engine";
import type { Track } from "../src/library/types";

function track(id: string): Track {
  return { id, source: "local", sourceTrackId: id, title: id, filePath: `/${id}.mp3`, addedAt: "2026-08-19T00:00:00Z" };
}

describe("PlaybackQueue", () => {
  it("can enqueue, move and recover queue state", () => {
    const database = NovaDatabase.memory();
    database.upsertTrack(track("local:a"));
    database.upsertTrack(track("local:b"));
    const queue = new PlaybackQueue(database);
    queue.enqueue("local:a");
    queue.enqueue("local:b");
    queue.move(1, 0);
    expect(queue.state().ids).toEqual(["local:b", "local:a"]);
    expect(new PlaybackQueue(database).state().ids).toEqual(["local:b", "local:a"]);
  });
});
