import { Box, Text } from "ink";
import { LOGO_LINES } from "../logo";
import { ACCENT_RAMP, lerpHex } from "../theme";

// Top row catches the light, bottom row falls into shadow: a cool Nova glow
// swept left→right across the wordmark. The shared accent ramp keeps the logo
// and progress fills on the same visual system.
const GRADIENT: readonly [string, string][] = [
  [ACCENT_RAMP[1], ACCENT_RAMP[0]],
  ["#7c6ad8", "#4338ca"],
];

/** The block wordmark, shaded with a per-character Nova gradient. */
export function Logo() {
  return (
    <Box flexDirection="column">
      {LOGO_LINES.map((line, row) => {
        const [from, to] = GRADIENT[Math.min(row, GRADIENT.length - 1)]!;
        const chars = [...line];
        const last = Math.max(1, chars.length - 1);
        return (
          <Box key={row}>
            {chars.map((ch, i) => (
              <Text key={i} bold color={lerpHex(from, to, i / last)}>
                {ch}
              </Text>
            ))}
          </Box>
        );
      })}
    </Box>
  );
}
