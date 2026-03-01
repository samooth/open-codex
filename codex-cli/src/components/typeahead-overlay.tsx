import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { useTerminalSizeContext } from "../contexts/terminal-size-context.js";
import { Box, Text, useInput } from "ink";
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
  const { columns } = useTerminalSizeContext();

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

  useInput(
    (_input, key) => {
      if (key.escape) {
        onExit();
      }
    },
    { isActive: true },
  );

  const handleSelect = (item: { value: T }) => {
    onSelect(item.value);
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
      width={Math.min(columns - 4, 100)}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black">
            {" "}
            {title.toUpperCase()}{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          SEARCH AND SELECT
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
            placeholder="Type to filter..."
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
          <Text color={theme.warning} italic>
            No matches found.
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
