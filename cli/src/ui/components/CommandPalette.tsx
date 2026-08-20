import { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { fuzzyScore } from "../../library/search";
import { COLOR, RULE } from "../theme";

export interface PaletteCommand {
  id: string;
  label: string;
  detail: string;
  run: () => void;
}

/** VS Code-inspired fuzzy command palette, deliberately dependency-free. */
export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const matches = useMemo(() => commands
    .map((command) => ({ command, score: fuzzyScore(query, `${command.label} ${command.detail}`) }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score || a.command.label.localeCompare(b.command.label))
    .slice(0, 7), [commands, query]);

  useInput((input, key) => {
    if (key.escape) return onClose();
    if (key.return) {
      const command = matches[selected]?.command;
      if (command) command.run();
      onClose();
      return;
    }
    if (key.upArrow) return setSelected((value) => Math.max(0, value - 1));
    if (key.downArrow) return setSelected((value) => Math.min(Math.max(0, matches.length - 1), value + 1));
    if (key.backspace || key.delete) return setQuery((value) => value.slice(0, -1));
    if (!key.ctrl && !key.meta && input) {
      setQuery((value) => value + input);
      setSelected(0);
    }
  });

  return (
    <Box borderStyle="round" borderColor={RULE} flexDirection="column" width={Math.max(46, 1)} paddingX={1} paddingY={1}>
      <Text color={COLOR.alt}>Command palette</Text>
      <Box marginTop={1}>
        <Text color={COLOR.accent}>{"> "}</Text>
        <Text>{query || "Type a command…"}</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {matches.length === 0 ? <Text dimColor>No matching commands.</Text> : matches.map((match, index) => (
          <Box key={match.command.id}>
            <Text color={index === selected ? COLOR.accent : undefined}>{index === selected ? "› " : "  "}</Text>
            <Text bold={index === selected}>{match.command.label}</Text>
            <Text dimColor>{` — ${match.command.detail}`}</Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1}><Text dimColor>↑↓ select  enter run  esc close</Text></Box>
    </Box>
  );
}
