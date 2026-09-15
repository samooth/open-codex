import type { Theme } from "../utils/theme.js";

import CenteredOverlay from "./centered-overlay.js";
import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { recipes } from "../utils/recipes.js";
import { Box, Text } from "ink";
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
    label: "/CONNECT",
    description: "Connect a model provider",
    value: "/connect",
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

  return (
    <CenteredOverlay
      title="commands"
      description="Search actions & recipes"
      footer="type filter · ↑↓ navigate · enter execute · esc close"
      theme={theme}
      onExit={onExit}
    >
      <Box flexDirection="column">
        <Box gap={1} marginBottom={1}>
          <Text color={theme.dim}>›</Text>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Type to filter commands…"
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
          <Text color={theme.warning}>No commands match your search.</Text>
        )}
      </Box>
    </CenteredOverlay>
  );
}
