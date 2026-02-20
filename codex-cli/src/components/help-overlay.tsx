import { Box, Text, useInput } from "ink";
import React from "react";
import type { Theme } from "../utils/theme.js";

/**
 * An overlay that lists the available slash‑commands and their description.
 */
export default function HelpOverlay({
  onExit,
  theme,
}: {
  onExit: () => void;
  theme: Theme;
}): JSX.Element {
  useInput((input, key) => {
    if (key.escape || input === "q") {
      onExit();
    }
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
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Text bold color={theme.highlight} inverse paddingX={1}> HELP </Text>
        <Text color={theme.highlight} bold>AVAILABLE COMMANDS</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box marginBottom={0}>
          <Text bold color={theme.accent}>SLASH COMMANDS</Text>
        </Box>
        {[
          ["/help", "show this help overlay"],
          ["/model", "switch the LLM model in‑session"],
          ["/approval", "switch auto‑approval mode"],
          ["/config", "toggle session settings (dry-run, debug)"],
          ["/prompt", "edit system instructions"],
          ["/prompts", "select from system prompt library"],
          ["/history", "view command/file history"],
          ["/index", "index codebase for semantic search"],
          ["/pin", "pin a file to context"],
          ["/unpin", "unpin a file from context"],
          ["/clear", "clear screen & context"],
          ["/undo", "revert last turn and file changes"],
        ].map(([cmd, desc]) => (
          <Box key={cmd} gap={1}>
            <Text color={theme.highlight} bold>{cmd?.padEnd(10)}</Text>
            <Text color={theme.dim}>–</Text>
            <Text>{desc}</Text>
          </Box>
        ))}

        <Box marginTop={1} marginBottom={0}>
          <Text bold color={theme.accent}>KEYBOARD SHORTCUTS</Text>
        </Box>
        {[
          ["Enter", "send message"],
          ["Ctrl+E", "open external editor ($EDITOR)"],
          ["Ctrl+Y", "copy last code block to clipboard"],
          ["Ctrl+P", "open command palette"],
          ["Up", "pull merged queue for editing (if empty)"],
          ["Up/Down", "scroll prompt history"],
          ["@", "trigger file path autocomplete"],
          ["Esc (x2)", "interrupt current action"],
          ["Ctrl+C", "quit OpenCodex"],
        ].map(([key, desc]) => (
          <Box key={key} gap={1}>
            <Text color={theme.warning} bold>{key?.padEnd(10)}</Text>
            <Text color={theme.dim}>–</Text>
            <Text>{desc}</Text>
          </Box>
        ))}
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
        <Text dimColor italic>esc or q to close</Text>
      </Box>
    </Box>
  );
}
