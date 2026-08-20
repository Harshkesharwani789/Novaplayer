import { describe, it, expect } from "vitest";
import { downloadStrategies, isStrategyFixable } from "../src/ytdlp/strategies";

describe("downloadStrategies", () => {
  it("tries reshaping the request before reaching for cookies", () => {
    const ids = downloadStrategies().map((s) => s.id);
    expect(ids).toEqual(["default", "web_embedded", "android_vr", "tv_simply"]);
  });

  // Regression guard for the ladder's real failure mode: these three clients
  // stayed in the list long after YouTube stopped serving them, so every retry
  // burned three attempts that could only fail. If one is ever re-added it
  // should be because it was re-verified against a live video, not inherited.
  it("does not ship client shapes that YouTube no longer serves", () => {
    const ids = downloadStrategies("chrome").map((s) => s.id);
    for (const dead of ["tv", "web_safari", "ios", "cookies+tv"]) {
      expect(ids).not.toContain(dead);
    }
  });

  it("puts the audio-only fallback ahead of the muxed-only ones", () => {
    const ids = downloadStrategies().map((s) => s.id);
    // web_embedded still returns format 251 (opus); android_vr / tv_simply
    // only return format 18, whose audio we extract at a lower bitrate.
    expect(ids.indexOf("web_embedded")).toBeLessThan(ids.indexOf("android_vr"));
    expect(ids.indexOf("web_embedded")).toBeLessThan(ids.indexOf("tv_simply"));
  });

  it("honours an explicitly configured browser on the first attempt", () => {
    const ids = downloadStrategies("chrome").map((s) => s.id);
    // Not last: a setting the user deliberately turned on should visibly take
    // effect, not sit behind three anonymous retries that might mask it.
    expect(ids[0]).toBe("cookies");
    expect(ids).toContain("default");
  });

  it("builds arguments yt-dlp actually accepts", () => {
    const embedded = downloadStrategies().find((s) => s.id === "web_embedded")!;
    expect(embedded.args).toEqual([
      "--extractor-args",
      "youtube:player_client=web_embedded",
    ]);

    const cookies = downloadStrategies("firefox").find((s) => s.id === "cookies")!;
    expect(cookies.args).toEqual(["--cookies-from-browser", "firefox"]);
  });
});

describe("isStrategyFixable", () => {
  // The whole point of the split: reshaping helps for a refusal, and is pure
  // wasted time for content that no longer exists. A 20-track playlist of dead
  // videos should fail once each, not four times each.
  it("retries refusals that are about HOW we asked", () => {
    expect(isStrategyFixable("ERROR: unable to download video data: HTTP Error 403: Forbidden")).toBe(true);
    expect(isStrategyFixable("ERROR: HTTP Error 403: Forbidden")).toBe(true);
    expect(isStrategyFixable("Some formats may be missing: nsig extraction failed")).toBe(true);
    expect(isStrategyFixable("ERROR: requested format is not available")).toBe(true);
  });

  // The bug this file exists to prevent recurring: every Spotify download in
  // the failure log ended on this line, and because it wasn't matched here the
  // loop treated it as fatal and never tried a single fallback.
  it("retries a player response YouTube wants re-fetched", () => {
    expect(isStrategyFixable("ERROR: [youtube] jkZ4FnFOgZY: The page needs to be reloaded.")).toBe(true);
    expect(isStrategyFixable("ERROR: [youtube] abc: Failed to extract any player response")).toBe(true);
  });

  it("does not retry content that is simply gone", () => {
    expect(isStrategyFixable("ERROR: [youtube] abc: Video unavailable")).toBe(false);
    expect(isStrategyFixable("ERROR: [youtube] abc: Private video")).toBe(false);
    expect(isStrategyFixable("ERROR: Video unavailable. This video is not available")).toBe(false);
    expect(isStrategyFixable("ERROR: removed by the uploader")).toBe(false);
  });

  it("does not retry ordinary unrelated failures", () => {
    expect(isStrategyFixable("ERROR: unable to open for writing: permission denied")).toBe(false);
    expect(isStrategyFixable("ERROR: ffmpeg not found")).toBe(false);
  });
});
