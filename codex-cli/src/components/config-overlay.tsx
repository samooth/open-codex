import SelectInput from "./select-input/select-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { Theme } from "../utils/theme.js";

type Props = {
  dryRun: boolean;
  debug: boolean;
  enableWebSearch: boolean;
  enableDeepThinking: boolean;
  onToggleDryRun: () => void;
  onToggleDebug: () => void;
  onToggleWebSearch: () => void;
  onToggleDeepThinking: () => void;
  onExit: () => void;
  theme: Theme;
};

export default function ConfigOverlay({
  dryRun,
  debug,
  enableWebSearch,
  enableDeepThinking,
  onToggleDryRun,
  onToggleDebug,
  onToggleWebSearch,
  onToggleDeepThinking,
  onExit,
  theme,
}: Props): JSX.Element {
  const items = [
    {
      label: `DRY RUN: ${dryRun ? "ENABLED" : "DISABLED"}`,
      value: "dryRun",
      description: "Preview changes without modifying actual files.",
    },
    {
      label: `DEBUG LOGGING: ${debug ? "ACTIVE" : "INACTIVE"}`,
      value: "debug",
      description: "Enable verbose logging for troubleshooting.",
    },
    {
      label: `WEB SEARCH: ${enableWebSearch ? "ENABLED" : "DISABLED"}`,
      value: "webSearch",
      description: "Allow the agent to search the web for information.",
    },
    {
      label: `DEEP THINKING: ${enableDeepThinking ? "ACTIVE" : "INACTIVE"}`,
      value: "deepThinking",
      description: "Force models to use thorough reasoning subroutine.",
    },
    {
      label: "CLOSE",
      value: "exit",
      description: "Return to the chat session.",
    },
  ];

  const [selectedDescription, setSelectedDescription] = useState(items[0]!.description);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (item: { value: string }) => {
    if (item.value === "dryRun") {
      onToggleDryRun();
    } else if (item.value === "debug") {
      onToggleDebug();
    } else if (item.value === "webSearch") {
      onToggleWebSearch();
    } else if (item.value === "deepThinking") {
      onToggleDeepThinking();
    } else if (item.value === "exit") {
      onExit();
    }
  };

  const handleHighlight = (item: { description: string }) => {
    setSelectedDescription(item.description);
  };

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
        <Text bold color={theme.highlight} inverse paddingX={1}> SETTINGS </Text>
        <Text color={theme.highlight} bold>CONFIGURATION DASHBOARD</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
        />
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
        <Text italic color={theme.dim}>{selectedDescription}</Text>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>↑↓ navigate │ enter toggle │ esc close</Text>
      </Box>
    </Box>
  );
}
