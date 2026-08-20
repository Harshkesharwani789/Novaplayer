import { describe, it, expect } from "vitest";
import {
  firstMeaningfulError,
  isAuthGateError,
  isRateLimitError,
} from "../src/ytdlp/ytdlp";

// These two classifiers used to be one. Splitting them matters because they
// lead to opposite advice: a rate limit clears if you wait, an auth gate never
// does. Conflating them is what produced a "blocked, retry later" row for a
// YouTube bot check, sending the user into a retry loop that could not succeed.
describe("isRateLimitError", () => {
  it("matches limits that genuinely clear on their own", () => {
    expect(isRateLimitError("ERROR: HTTP Error 429: Too Many Requests")).toBe(true);
    expect(isRateLimitError("This IP is temporarily blocked")).toBe(true);
  });

  it("does NOT claim an auth gate will clear by waiting", () => {
    expect(isRateLimitError("Sign in to confirm you're not a bot")).toBe(false);
    expect(isRateLimitError("ERROR: HTTP Error 403: Forbidden")).toBe(false);
  });

  it("ignores ordinary failures", () => {
    expect(isRateLimitError("ERROR: Video unavailable")).toBe(false);
    expect(isRateLimitError("Private video")).toBe(false);
  });
});

describe("isAuthGateError", () => {
  it("matches the ways a platform says 'you are not signed in'", () => {
    expect(isAuthGateError("Sign in to confirm you're not a bot")).toBe(true);
    expect(isAuthGateError("ERROR: HTTP Error 403: Forbidden")).toBe(true);
    expect(isAuthGateError("Please confirm your age")).toBe(true);
    expect(isAuthGateError("status: LOGIN_REQUIRED")).toBe(true);
    expect(
      isAuthGateError("Use --cookies-from-browser or --cookies for authentication"),
    ).toBe(true);
  });

  it("ignores ordinary failures and plain rate limits", () => {
    expect(isAuthGateError("ERROR: Video unavailable")).toBe(false);
    expect(isAuthGateError("ERROR: HTTP Error 429: Too Many Requests")).toBe(false);
  });

  // Every needle is a whole phrase for this reason: matching fragments sends
  // the user to configure cookies for failures cookies cannot fix, which is
  // strictly worse than saying nothing.
  it("does not fire on words that merely CONTAIN a keyword", () => {
    expect(isAuthGateError("ERROR: unable to parse server message")).toBe(false);
    expect(isAuthGateError("ERROR: disk usage exceeded")).toBe(false);
    expect(isAuthGateError("ERROR: package install failed")).toBe(false);
    expect(isAuthGateError("Writing cookies to file")).toBe(false);
    expect(isAuthGateError("ERROR: logout succeeded")).toBe(false);
  });
});

describe("firstMeaningfulError", () => {
  it("prefers yt-dlp's own ERROR line over surrounding chatter", () => {
    const lines = [
      "[youtube] Extracting URL",
      "ERROR: [youtube] abc: Sign in to confirm you're not a bot",
      "[download] Got error, retrying",
    ];
    expect(firstMeaningfulError(lines)).toBe(
      "[youtube] abc: Sign in to confirm you're not a bot",
    );
  });

  it("falls back to the last non-empty line, and never returns nothing", () => {
    expect(firstMeaningfulError(["first", "last", "  "])).toBe("last");
    expect(firstMeaningfulError([])).toBe("no output");
  });
});
