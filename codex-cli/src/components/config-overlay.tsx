import SelectInput from "./select-input/select-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

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
}: Props): JSX.Element {
  const [selectedIndex] = useState(0);

  const items = [
    {
      label: `Dry Run: ${dryRun ? "ON" : "OFF"}`,
      value: "dryRun",
    },
    {
      label: `Debug Logging: ${debug ? "ON" : "OFF"}`,
      value: "debug",
    },
    {
      label: `Web Search (Lynx): ${enableWebSearch ? "ON" : "OFF"}`,
      value: "webSearch",
    },
    {
      label: `Deep Thinking Prefix: ${enableDeepThinking ? "ON" : "OFF"}`,
      value: "deepThinking",
    },
    {
      label: "Close",
      value: "exit",
    },
  ];

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

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="gray"
      width={80}
    >
      <Box paddingX={1}>
        <Text bold>Session Configuration</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginY={1}>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          initialIndex={selectedIndex}
        />
      </Box>

      <Box paddingX={1}>
        <Text dimColor>↑↓ to navigate · enter to toggle/select · esc to close</Text>
      </Box>
    </Box>
  );
}
