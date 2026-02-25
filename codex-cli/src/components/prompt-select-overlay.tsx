import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { Box, Text, useInput } from "ink";
import React from "react";


// Mock prompts since we don't have a real library yet
const availablePrompts = [
  { label: "DEFAULT - Balanced coding assistant", value: "default", instructions: "You are OpenCodex, a senior software engineer..." },
  { label: "TESTER - Focus on unit tests and edge cases", value: "tester", instructions: "You are OpenCodex. Your goal is to write comprehensive tests..." },
  { label: "REFACTOR - Focus on clean code and patterns", value: "refactor", instructions: "You are OpenCodex. Focus on refactoring for clarity and patterns..." },
];

export default function PromptSelectOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (instructions: string, name: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  useInput((_input, key) => {
    if (key.escape) {onExit();}
  });

  const handleSelect = (item: any) => {
    onSelect(item.instructions, item.value);
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
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black"> LIBRARY </Text>
        </Box>
        <Text color={theme.highlight} bold>SELECT SYSTEM PROMPT</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <SelectInput
          items={availablePrompts}
          onSelect={handleSelect}
          theme={theme}
          isFocused={true}
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
        <Text dimColor italic>↑↓ navigate │ enter select │ esc close</Text>
      </Box>
    </Box>
  );
}
