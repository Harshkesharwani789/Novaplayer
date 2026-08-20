import { useMemo } from "react";
import { Box, Text } from "ink";
import { Header } from "../components/Header";
import { useHistory, useStore } from "../store";
import { COLOR, ICON } from "../theme";

function runtime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function Bars({ values }: { values: Array<{ name: string; plays: number }> }) {
  const peak = Math.max(1, ...values.map((value) => value.plays));
  return (
    <Box flexDirection="column">
      {values.length === 0 ? <Text dimColor>No listening activity yet.</Text> : values.map((value) => (
        <Box key={value.name}>
          <Text wrap="truncate-end" color={COLOR.text}>{value.name.padEnd(18).slice(0, 18)}</Text>
          <Text color={COLOR.good}>{` ${"▰".repeat(Math.max(1, Math.round((value.plays / peak) * 14)))}`}</Text>
          <Text dimColor>{` ${value.plays}`}</Text>
        </Box>
      ))}
    </Box>
  );
}

/** Compact terminal analytics backed by the history table. */
export function Analytics() {
  const { history, region } = useStore();
  const version = useHistory(history);
  const snapshot = useMemo(() => history.analytics(), [history, version]);
  const focused = region === "content";

  return (
    <Box flexDirection="column">
      <Header title="Analytics" subtitle={`${runtime(snapshot.totalListeningSec)} listened`} focused={focused} />
      <Box marginBottom={1}>
        <Text color={COLOR.alt}>Local listening history</Text>
        <Text dimColor>{`  ${ICON.dot}  no telemetry`}</Text>
      </Box>
      <Text bold>Top artists</Text>
      <Bars values={snapshot.topArtists} />
      <Box marginTop={1} flexDirection="column">
        <Text bold>Top albums</Text>
        <Bars values={snapshot.topAlbums} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Top genres</Text>
        <Bars values={snapshot.topGenres} />
      </Box>
    </Box>
  );
}
