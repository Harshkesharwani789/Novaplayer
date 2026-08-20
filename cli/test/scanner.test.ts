import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Library } from "../src/library/library";
import { parseFilename, scanLibrary } from "../src/library/scanner";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("local library scanner", () => {
  it("parses conventional artist-title filenames", () => {
    expect(parseFilename("/music/03 - M83 - Midnight City.mp3")).toEqual({ artist: "M83", title: "Midnight City" });
  });

  it("indexes audio files and skips unchanged entries on an incremental scan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "nova-scan-"));
    cleanup.push(root);
    await fs.mkdir(path.join(root, "Electronic"));
    await fs.writeFile(path.join(root, "Electronic", "M83 - Midnight City.mp3"), "not-real-audio");
    const library = Library.empty();

    const first = await scanLibrary(root, library);
    const second = await scanLibrary(root, library);

    expect(first.indexed).toBe(1);
    expect(library.all()[0]?.artist).toBe("M83");
    expect(second.skipped).toBe(1);
  });
});
