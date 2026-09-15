import type { Theme } from "../utils/theme.js";

import CenteredOverlay from "./centered-overlay.js";
import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { Box, Text } from "ink";
import React, { useState, useMemo } from "react";

type Props<T> = {
  title: string;
  items: Array<{ label: string; value: T; description?: string }>;
  onSelect: (value: T) => void;
  onExit: () => void;
  theme: Theme;
};

export default function TypeaheadOverlay<T>({
  title,
  items,
  onSelect,
  onExit,
  theme,
}: Props<T>) {
  const [query, setQuery] = useState("");

  const filteredItems = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) {
      return items;
    }
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  }, [items, query]);

  const handleSelect = (item: { value: T }) => {
    onSelect(item.value);
  };

  return (
    <CenteredOverlay
      title={title}
      footer="type filter · ↑↓ navigate · enter select · esc close"
      theme={theme}
      onExit={onExit}
    >
      <Box flexDirection="column">
        <Box gap={1} marginBottom={1}>
          <Text color={theme.dim}>›</Text>
          <TextInput
            value={query}
            onChange={setQuery}
            placeholder="Type to filter…"
          />
        </Box>

        {filteredItems.length > 0 ? (
          <SelectInput
            items={filteredItems}
            onSelect={handleSelect}
            theme={theme}
            isFocused={true}
          />
        ) : (
          <Text color={theme.warning}>No matches found.</Text>
        )}
      </Box>
    </CenteredOverlay>
  );
}
