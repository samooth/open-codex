import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { Theme } from "../utils/theme.js";

export type TypeaheadItem = { label: string; value: string };

type Props = {
  title: string;
  description?: React.ReactNode;
  initialItems: Array<TypeaheadItem>;
  currentValue?: string;
  limit?: number;
  onSelect: (value: string) => void;
  onExit: () => void;
  theme: Theme;
};

/**
 * Generic overlay that combines a TextInput with a filtered SelectInput.
 * It is intentionally dependency‑free so it can be re‑used by multiple
 * overlays (model picker, command picker, …).
 */
export default function TypeaheadOverlay({
  title,
  description,
  initialItems,
  currentValue,
  limit = 10,
  onSelect,
  onExit,
  theme,
}: Props): JSX.Element {
  const [value, setValue] = useState("");
  const [items, setItems] = useState<Array<TypeaheadItem>>(initialItems);

  // Keep internal items list in sync when the caller provides new options
  // (e.g. ModelOverlay fetches models asynchronously).
  React.useEffect(() => {
    setItems(initialItems);
  }, [initialItems]);

  /* ------------------------------------------------------------------ */
  /* Exit on ESC                                                         */
  /* ------------------------------------------------------------------ */
  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  /* ------------------------------------------------------------------ */
  /* Filtering & Ranking                                                 */
  /* ------------------------------------------------------------------ */
  const q = value.toLowerCase();
  const filtered =
    q.length === 0
      ? items
      : items.filter((i) => i.label.toLowerCase().includes(q));

  const ranked = filtered.sort((a, b) => {
    if (a.value === currentValue) {
      return -1;
    }
    if (b.value === currentValue) {
      return 1;
    }

    if (q.length === 0) {
      return 0;
    }

    const ia = a.label.toLowerCase().indexOf(q);
    const ib = b.label.toLowerCase().indexOf(q);
    if (ia !== ib) {
      return ia - ib;
    }
    return a.label.localeCompare(b.label);
  });

  const selectItems = ranked;
  const initialIndex = selectItems.findIndex((i) => i.value === currentValue);

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
        <Text bold color={theme.highlight} inverse paddingX={1}> {title.toUpperCase()} </Text>
        {description && <Box paddingLeft={1}>{description}</Box>}
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={theme.highlight} bold>SEARCH: </Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={(submitted) => {
              if (selectItems.length === 0) {
                const target = submitted.trim();
                if (target) {
                  onSelect(target);
                } else {
                  onExit();
                }
              }
            }}
          />
        </Box>
        
        {selectItems.length > 0 && (
          <SelectInput
            limit={limit}
            items={selectItems}
            initialIndex={initialIndex === -1 ? 0 : initialIndex}
            isFocused={true}
            theme={theme}
            onSelect={(item: TypeaheadItem) => {
              if (item.value) {
                onSelect(item.value);
              }
            }}
          />
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
        <Text dimColor italic>↑↓ navigate │ enter confirm │ esc close</Text>
      </Box>
    </Box>
  );
}
