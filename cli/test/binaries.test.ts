import { describe, it, expect, vi, afterEach } from "vitest";

// Regression test for the "Couldn't finish setup, check your internet" boot
// bug: ensureBinaries() used to `await ensureYtDlp()` directly, so a slow or
// hung yt-dlp download blocked the *entire* app — you couldn't even browse an
// already-scanned library. Neither enumerate() nor downloadTrack() (the only
// real consumers of the yt-dlp binary) read the resolved value ensureBinaries
// returns; they call ytDlpPath() themselves at invocation time. So the fetch
// belongs in the background, gating only the download queue (which already
// has its own ensureTools() gate for ffmpeg) — not first paint.

vi.mock("../src/bin/ytdlp-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bin/ytdlp-fetch")>();
  return {
    ...actual,
    // Simulates a stalled/offline first-run download that never settles.
    ensureYtDlp: vi.fn(() => new Promise<string>(() => {})),
  };
});

vi.mock("../src/bin/ffmpeg-fetch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bin/ffmpeg-fetch")>();
  return {
    ...actual,
    ensureFfmpeg: vi.fn(() => new Promise<void>(() => {})),
  };
});

async function resolvesWithin<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`did not resolve within ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

describe("ensureBinaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves without waiting on yt-dlp or ffmpeg, even if both hang", async () => {
    const { ensureBinaries } = await import("../src/bin/binaries");
    const binaries = await resolvesWithin(ensureBinaries(), 2000);
    // Paths are still returned (pure path math), just not awaited-fetched.
    expect(binaries.ytDlp).toContain("yt-dlp");
    expect(binaries.ffmpeg).toBeTruthy();
    expect(binaries.ffprobe).toBeTruthy();
  });
});

describe("ensureDownloadTools", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is what actually gates a download (never resolves while either tool is stuck)", async () => {
    const { ensureDownloadTools } = await import("../src/bin/binaries");
    await expect(resolvesWithin(ensureDownloadTools(), 300)).rejects.toThrow(
      /did not resolve/,
    );
  });
});
