import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { recipes } from "../utils/recipes.js";
import { Box, Text, useInput } from "ink";
import React, { useState, useMemo } from "react";

const slashCommands = [
  {
    label: "/MODEL",
    description: "Switch LLM model",
    value: "/model",
    type: "command",
  },
  {
    label: "/CLEAR",
    description: "Reset conversation context",
    value: "/clear",
    type: "command",
  },
  {
    label: "/HISTORY",
    description: "View command history",
    value: "/history",
    type: "command",
  },
  {
    label: "/RESTORE",
    description: "Load a past session",
    value: "/history restore",
    type: "command",
  },
  {
    label: "/MEMORY",
    description: "Manage project knowledge",
    value: "/memory",
    type: "command",
  },
  {
    label: "/APPROVAL",
    description: "Change auto-approval mode",
    value: "/approval",
    type: "command",
  },
  {
    label: "/CONFIG",
    description: "TUI settings dashboard",
    value: "/config",
    type: "command",
  },
  {
    label: "/PROMPT",
    description: "Edit system instructions",
    value: "/prompt",
    type: "command",
  },
  {
    label: "/LIBRARY",
    description: "Select system prompt",
    value: "/prompts",
    type: "command",
  },
  {
    label: "/THEME",
    description: "Switch UI theme",
    value: "/theme",
    type: "command",
  },
  {
    label: "/UNDO",
    description: "Revert last turn",
    value: "/undo",
    type: "command",
  },
  {
    label: "/INDEX",
    description: "Semantic indexing",
    value: "/index",
    type: "command",
  },
];

type CommandItem = {
  label: string;
  value: string;
  type: string;
  description?: string;
};

export default function CommandPaletteOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (value: string, type: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [query, setQuery] = useState("");

  const allItems = useMemo(() => {
    const recipeItems = recipes.map((r) => ({
      label: `RECIPE: ${r.name.toUpperCase()}`,
      description: r.description,
      value: r.name,
      type: "recipe",
    }));
    return [...slashCommands, ...recipeItems];
  }, []);

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) {
      return allItems;
    }
    return allItems.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  }, [allItems, query]);

  useInput((_input, key) => {
    if (key.escape) {
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
      width={100}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Box backgroundColor={theme.highlight} paddingX={1}>
          <Text bold color="black">
            {" "}
            COMMAND PALETTE{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          SEARCH ACTIONS & RECIPES
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={theme.highlight} bold>
            FIND:{" "}
          </Text>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Type to filter commands..."
          />
        </Box>

        {filteredItems.length > 0 ? (
          <SelectInput
            items={filteredItems}
            onSelect={
              ((item: CommandItem) => onSelect(item.value, item.type)) as any
            }
            theme={theme}
            isFocused={true}
          />
        ) : (
          <Text color={theme.warning} italic>
            No commands match your search.
          </Text>
        )}
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
          ↑↓ navigate │ enter execute │ esc close
        </Text>
      </Box>
    </Box>
  );
}
