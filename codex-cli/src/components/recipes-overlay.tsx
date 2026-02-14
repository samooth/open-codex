import { Box, Text, useInput } from "ink";
import React from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import { recipes, type Recipe } from "../utils/recipes.js";

export default function RecipesOverlay({
  onSelect,
  onExit,
}: {
  onSelect: (recipe: Recipe) => void;
  onExit: () => void;
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const options = recipes.map((r) => ({
    label: `${r.name.padEnd(25)} - ${r.description}`,
    value: r.name,
  }));

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="magentaBright" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="magentaBright">Select Prompt Template (Recipe)</Text>
      </Box>
      
      <Box borderStyle="single" paddingX={1}>
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

      <Box marginTop={1}>
        <Text dimColor>
          Use arrow keys to select • Press <Text bold>Enter</Text> to apply • <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}