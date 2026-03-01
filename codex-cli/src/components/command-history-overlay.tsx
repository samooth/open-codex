import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import type { Theme } from "../utils/theme.js";
import { TOOL_SHELL } from "../utils/agent/tool-constants.js";
import { Box, Text, useInput } from "ink";
import React, { useMemo } from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select";

type Props = {
  items: Array<ChatCompletionMessageParam>;
  onSelect: (command: string) => void;
  onExit: () => void;
  theme: Theme;
};

export const CommandHistoryOverlay: React.FC<Props> = ({
  items,
  onSelect,
  onExit,
  theme,
}) => {
  const commands = useMemo(() => {
    const cmds: string[] = [];
    for (const item of items) {
      if (item.role === "assistant" && item.tool_calls) {
        for (const tc of item.tool_calls) {
          if (tc.type === "function" && tc.function.name === TOOL_SHELL) {
            try {
              const args = JSON.parse(tc.function.arguments);
              if (args.cmd && Array.isArray(args.cmd)) {
                cmds.push(args.cmd.join(" "));
              } else if (args.command) {
                cmds.push(args.command);
              }
            } catch {
              // ignore
            }
          }
        }
      }
    }
    return [...new Set(cmds)].reverse(); // Unique and most recent first
  }, [items]);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  if (commands.length === 0) {
    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={theme.error}
        paddingX={2}
        paddingY={1}
        position="absolute"
        width={60}
      >
        <Text bold color={theme.error}>
          {" "}
          NO SHELL COMMANDS FOUND{" "}
        </Text>
        <Box marginTop={1}>
          <Text>There are no shell commands in the current history.</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press ESC to exit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.highlight}
      paddingX={2}
      paddingY={1}
      position="absolute"
      width={70}
    >
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight} paddingX={1}>
          <Text bold color="black">
            {" "}
            COMMAND HISTORY{" "}
          </Text>
        </Box>
        <Text dimColor italic>
          {" "}
          (↑↓ navigate │ enter to select │ esc exit)
        </Text>
      </Box>

      <Select
        theme={theme}
        options={commands.map((cmd) => ({
          label: cmd.length > 60 ? cmd.slice(0, 57) + "..." : cmd,
          value: cmd,
        }))}
        onChange={(val: string) => onSelect(val)}
      />

      <Box
        marginTop={1}
        borderStyle="single"
        borderLeft={false}
        borderRight={false}
        borderBottom={false}
        borderTopColor={theme.divider}
        paddingTop={1}
      >
        <Text color={theme.dim} italic>
          Tip: Selecting a command will place it in your input buffer for
          editing.
        </Text>
      </Box>
    </Box>
  );
};

export default CommandHistoryOverlay;
