import React from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "../utils/theme.js";

const shortcuts = [
  ["Ctrl+E", "Open prompt in external editor"],
  ["Ctrl+P", "Open Command Palette"],
  ["Ctrl+R", "Open Shell Command History"],
  ["Ctrl+Y", "Copy last code block"],
  ["Ctrl+F", "Toggle focus mode for shell"],
  ["Ctrl+B", "Toggle token usage breakdown"],
  ["Ctrl+J", "Insert newline in input"],
  ["C", "Toggle collapse/expand Turn"],
  ["@", "Trigger file autocomplete"],
  ["Up Arrow", "Edit merged instruction queue"],
];

const commands = [
  ["/model", "Switch LLM model"],
  ["/clear", "Reset conversation context"],
  ["/undo", "Revert last Turn"],
  ["/history", "View session transcript"],
  ["/memory", "Manage project knowledge"],
  ["/config", "TUI settings dashboard"],
  ["/theme", "Switch UI theme"],
];

export default function HelpOverlay({
  onExit,
  theme,
}: {
  onExit: () => void;
  theme: Theme;
}) {
  useInput((_input, key) => {
    if (key.escape) onExit();
  });

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={80}
      height={22}
      marginY={1}
    >
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black"> HELP </Text>
        </Box>
        <Text color={theme.highlight} bold>KEYBOARD SHORTCUTS & COMMANDS</Text>
      </Box>

      <Box flexDirection="row" flexGrow={1}>
        <Box flexDirection="column" width={40} paddingX={1}>
          <Text bold underline color={theme.accent}>SHORTCUTS</Text>
          {shortcuts.map(([key, desc]) => (
            <Box key={key} gap={1}>
              <Text color={theme.highlight} bold>{key?.padEnd(8)}</Text>
              <Text color={theme.dim}>{desc}</Text>
            </Box>
          ))}
        </Box>
        <Box flexDirection="column" width={40} paddingX={1}>
          <Text bold underline color={theme.accent}>COMMANDS</Text>
          {commands.map(([cmd, desc]) => (
            <Box key={cmd} gap={1}>
              <Text color={theme.highlight} bold>{cmd?.padEnd(8)}</Text>
              <Text color={theme.dim}>{desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box 
        borderStyle="single" 
        borderRight={false} 
        borderTop={true} 
        borderBottom={false} 
        borderLeft={false}
        borderTopColor={theme.divider}
        paddingX={1}
        paddingTop={1}
      >
        <Text dimColor italic>esc close help</Text>
      </Box>
    </Box>
  );
}
