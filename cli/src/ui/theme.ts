// Central visual vocabulary for the TUI: one place for accent colors and the
// small glyph set we trust to render in a terminal. Keeping these here means
// every section speaks the same visual language instead of each picking its own.

import { defaultTheme, extendTheme } from "@inkjs/ui";

export const COLOR = {
  /** Nova violet drives focus, cursors, and progress. */
  accent: "#a78bfa",
  /** Cool white keeps dense terminal surfaces comfortably legible. */
  text: "#e8edf9",
  /** Cyan is reserved for paths, inline keys, and section headers. */
  alt: "#67e8f9",
  /** Now-playing / success remains visually distinct from the Nova hue. */
  good: "#6ee7b7",
  /** Warnings stay warm while the product palette stays cool. */
  warn: "#fbbf24",
  /** Failures: rose, pushed pink/cool so errors never read as the accent. */
  bad: "#ee7d92",
  /** Electric lilac: the bright end of the Nova accent ramp. */
  amber: "#c4b5fd",
} as const;

/**
 * Glyphs known to render in Windows Terminal, macOS Terminal, and common Linux
 * emulators. Kept deliberately tiny.
 */
export const ICON = {
  play: "▶",
  pause: "⏸",
  done: "✓",
  error: "✗",
  canceled: "⊘",
  skipped: "•",
  pending: "·",
  pointer: "❯",
  dot: "·",
  warn: "⚠",
  shuffle: "⇄",
  repeat: "↻",
  /** Solid left edge used to mark the active nav row. */
  bar: "▌",
} as const;

/** A soft indigo gray used for separators and rules. */
export const RULE = "#5b6485";

/** Parse "#rrggbb" into [r, g, b]. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Linear-interpolate two "#rrggbb" colors; t in [0, 1]. */
export function lerpHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/**
 * The accent's glow ramp (violet → lilac). Progress fills and the wordmark
 * sweep share it, so the terminal reads as one calm Nova surface.
 */
export const ACCENT_RAMP: readonly [string, string] = [
  COLOR.accent,
  COLOR.amber,
];

/**
 * @inkjs/ui theme override so its Select and Spinner share our orange accent
 * instead of their default green/blue. Without this the list cursor and
 * loading spinners would clash with the brand color.
 */
export const uiTheme = extendTheme(defaultTheme, {
  components: {
    Select: {
      styles: {
        focusIndicator: () => ({ color: COLOR.accent }),
        selectedIndicator: () => ({ color: COLOR.accent }),
        label: (props: { isFocused?: boolean; isSelected?: boolean } = {}) => ({
          color: props.isFocused || props.isSelected ? COLOR.accent : undefined,
        }),
      },
    },
    Spinner: {
      styles: {
        frame: () => ({ color: COLOR.accent }),
      },
    },
  },
});
