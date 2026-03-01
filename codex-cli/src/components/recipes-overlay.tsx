import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { recipes } from "../utils/recipes.js";
import { Box, Text, useInput } from "ink";
import React from "react";

export default function RecipesOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (recipe: any) => void;
  onExit: () => void;
  theme: Theme;
}) {
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (item: any) => {
    const recipe = recipes.find((r) => r.name === item.value);
    if (recipe) {
      onSelect(recipe);
    }
  };

  const options = recipes.map((r) => ({
    label: r.name.toUpperCase(),
    value: r.name,
    description: r.description,
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
      width={80}
      marginY={1}
    >
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black">
            {" "}
            RECIPES{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          SELECT A PROMPT TEMPLATE
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <SelectInput
          items={options}
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
        <Text dimColor italic>
          ↑↓ navigate │ enter run │ esc close
        </Text>
      </Box>
    </Box>
  );
}
