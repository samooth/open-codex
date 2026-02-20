import { Box, Text, useInput } from "ink";
import React from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import { recipes, type Recipe } from "../utils/recipes.js";
import type { Theme } from "../utils/theme.js";

export default function RecipesOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (recipe: Recipe) => void;
  onExit: () => void;
  theme: Theme;
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const options = recipes.map((r) => ({
    label: `${r.name.toUpperCase().padEnd(20)} │ ${r.description}`,
    value: r.name,
  }));

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={100}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Text bold color={theme.highlight} inverse paddingX={1}> RECIPES </Text>
        <Text color={theme.highlight} bold>SELECT PROMPT TEMPLATE</Text>
      </Box>

      <Box paddingX={1} marginBottom={1}>
        <Select
          options={options}
          onChange={(value: string) => {
            const selected = recipes.find((r) => r.name === value);
            if (selected) {
              onSelect(selected);
            }
          }}
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
        <Text dimColor italic>
          ↑↓ navigate │ enter apply │ esc close
        </Text>
      </Box>
    </Box>
  );
}