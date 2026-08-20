/**
 * How to ask YouTube for a file when the straightforward ask is refused.
 *
 * The failures this exists for look like:
 *
 *   ERROR: unable to download video data: HTTP Error 403: Forbidden
 *   ERROR: [youtube] <id>: The page needs to be reloaded.
 *
 * which are easy to misread. Neither is the "Sign in to confirm you're not a
 * bot" gate, and neither is a rate limit — listing the playlist worked, and the
 * next track fails the same way a second later, so nothing is being throttled.
 * It is YouTube refusing the specific request shape yt-dlp used: a player
 * client whose media URLs that IP/session isn't allowed to fetch, or one whose
 * player response came back unusable.
 *
 * Which shape works is not knowable from here. It varies by video, by network,
 * by region, and by whatever YouTube changed this week. So rather than pick one
 * and hope, the downloader tries a short ordered list and keeps the first that
 * works — the same way a browser negotiates a codec instead of assuming one.
 */
export interface Strategy {
  id: string;
  /** Shown to the user when this is the one that worked. */
  label: string;
  args: string[];
}

/**
 * Ordered best-quality-and-most-likely first.
 *
 * The clients here are the ones that actually still serve audio. That list is
 * perishable and has to be re-checked against a real video rather than
 * inherited: `tv`, `web_safari` and `ios` all sat at the top of this ladder
 * long after YouTube stopped serving them, so every retry walked three shapes
 * that could only fail — `tv` answering "The page needs to be reloaded." and
 * the other two "Requested format is not available". A ladder of dead rungs is
 * worse than no ladder, because it converts one honest error into a confusing
 * one and takes four times as long to do it.
 *
 * `default` is first because letting yt-dlp negotiate the client itself is what
 * works most often, and it yields a real audio-only stream (format 251, opus).
 * `web_embedded` is the one explicit client that also returns audio-only, so it
 * is the only lossless-quality fallback. The last two return format 18 — a
 * 360p muxed MP4 whose ~96 kbps AAC we extract — so they are a genuine quality
 * downgrade and are deliberately last: a lower-bitrate file still beats a
 * failed download, but should never pre-empt one that would have been clean.
 *
 * Cookies stay separate: they're the heaviest option (a Keychain prompt on
 * macOS, and useless if the user isn't signed in).
 */
export function downloadStrategies(cookieBrowser?: string): Strategy[] {
  const client = (c: string): string[] => ["--extractor-args", `youtube:player_client=${c}`];
  const anonymous: Strategy[] = [
    { id: "default", label: "default", args: [] },
    { id: "web_embedded", label: "embedded player", args: client("web_embedded") },
    { id: "android_vr", label: "Android VR client", args: client("android_vr") },
    { id: "tv_simply", label: "simple TV client", args: client("tv_simply") },
  ];
  if (!cookieBrowser) return anonymous;

  // Turning cookies on is an explicit act, so honour it on the FIRST attempt
  // rather than after three anonymous failures — otherwise the setting appears
  // to do nothing for anything that the anonymous shapes happen to fix. The
  // paired fallback uses web_embedded rather than tv for the same reason the
  // anonymous ladder does: tv cannot currently succeed.
  const cookies = ["--cookies-from-browser", cookieBrowser];
  return [
    { id: "cookies", label: `${cookieBrowser} cookies`, args: cookies },
    {
      id: "cookies+web_embedded",
      label: `${cookieBrowser} cookies + embedded player`,
      args: [...cookies, ...client("web_embedded")],
    },
    ...anonymous,
  ];
}

/**
 * Whether a different request shape could plausibly succeed where this one
 * failed.
 *
 * The distinction that matters: "Video unavailable" / "Private video" means the
 * content is gone or restricted, and every strategy will fail identically —
 * retrying six ways just wastes the user's time and makes a 20-track playlist
 * take six times longer to report the same result. A 403, a signature/nsig
 * failure, a format problem, or a player response YouTube wants re-fetched is
 * about HOW we asked, and is worth re-asking.
 *
 * "The page needs to be reloaded." earns its place here the hard way: it is
 * what the `tv` client returns, and because it was missing from this list the
 * loop treated it as fatal and gave up after a single attempt. Every Spotify
 * download in the failure log died that way — resolved to a real video, then
 * abandoned without ever trying the fallbacks that exist for exactly this.
 */
export function isStrategyFixable(text: string): boolean {
  if (/video unavailable|private video|removed by the uploader|account associated .* has been terminated|copyright/i.test(text)) {
    return false;
  }
  return /HTTP Error 403|403[: ]?Forbidden|unable to download video data|nsig|signature|requested format is not available|precondition check failed|fragment .* not found|page needs to be reloaded|unable to extract (?:player|yt initial)|failed to extract any player response/i.test(
    text,
  );
}
