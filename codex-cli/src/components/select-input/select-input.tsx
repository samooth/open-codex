import type { Theme } from "../../utils/theme.js";

import Indicator, { type Props as IndicatorProps } from "./indicator.js";
import ItemComponent, { type Props as ItemProps } from "./item.js";
import { Box, Text, useInput } from "ink";
import React, { type FC, useState, useEffect, useRef, useCallback } from "react";

type Props<V> = {
  /**
   * Items to display in a list. Each item must be an object and have `label` and `value` props, it may also optionally have a `key` prop.
   * If no `key` prop is provided, `value` will be used as the item key.
   */
  readonly items?: Array<Item<V>>;

  /**
   * Listen to user's input. Useful in case there are multiple input components at the same time and input must be "routed" to a specific component.
   *
   * @default true
   */
  readonly isFocused?: boolean;

  /**
   * Index of initially-selected item in `items` array.
   *
   * @default 0
   */
  readonly initialIndex?: number;

  /**
   * Custom component to override the default indicator component.
   */
  readonly indicatorComponent?: FC<IndicatorProps>;

  /**
   * Custom component to override the default item component.
   */
  readonly itemComponent?: FC<ItemProps>;

  /**
   * Function to call when user selects an item. Item object is passed to that function as an argument.
   */
  readonly onSelect?: (item: Item<V>) => void;

  /**
   * Function to call when user highlights an item. Item object is passed to that function as an argument.
   */
  readonly onHighlight?: (item: Item<V>) => void;

  /**
   * Current UI theme.
   */
  readonly theme: Theme;

  /**
   * Number of items to display per page. If not provided, pagination is disabled.
   */
  readonly itemsPerPage?: number;
};

export type Item<V> = {
  key?: string;
  label: string;
  value: V;
};

function SelectInput<V>({
  items = [],
  isFocused = true,
  initialIndex = 0,
  indicatorComponent = Indicator,
  itemComponent = ItemComponent,
  onSelect,
  onHighlight,
  theme,
  itemsPerPage,
}: Props<V>): React.ReactElement {
  const [currentPage, setCurrentPage] = useState(0);
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const lastInputTime = useRef(0);

  const isPaginated = itemsPerPage && items.length > itemsPerPage;
  const totalPages = isPaginated ? Math.ceil(items.length / itemsPerPage) : 1;

  const pageStartIndex = isPaginated ? currentPage * itemsPerPage : 0;
  const pageEndIndex = isPaginated ? pageStartIndex + itemsPerPage : items.length;
  const paginatedItems = items.slice(pageStartIndex, pageEndIndex);

  useEffect(() => {
    // Reset to first page if items change
    setCurrentPage(0);
    setSelectedIndex(0);
  }, [items]);

  useEffect(() => {
    // When page changes, reset selection to the top of the new page
    setSelectedIndex(0);
    if (typeof onHighlight === "function") {
      onHighlight(paginatedItems[0]!);
    }
  }, [currentPage]);

  useInput(
    useCallback(
      (input, key) => {
        if (!isFocused) {return;}
        
        const now = Date.now();
        if (now - lastInputTime.current < 30) { // Slightly faster debounce
          return;
        }
        lastInputTime.current = now;

        if (input === "k" || key.upArrow) {
          const newIndex = selectedIndex === 0 ? paginatedItems.length - 1 : selectedIndex - 1;
          setSelectedIndex(newIndex);
          if (typeof onHighlight === "function") {
            onHighlight(paginatedItems[newIndex]!);
          }
        }

        if (input === "j" || key.downArrow) {
          const newIndex = selectedIndex === paginatedItems.length - 1 ? 0 : selectedIndex + 1;
          setSelectedIndex(newIndex);
          if (typeof onHighlight === "function") {
            onHighlight(paginatedItems[newIndex]!);
          }
        }

        if (isPaginated && key.leftArrow) {
          setCurrentPage(prev => (prev === 0 ? totalPages - 1 : prev - 1));
        }

        if (isPaginated && key.rightArrow) {
          setCurrentPage(prev => (prev === totalPages - 1 ? 0 : prev + 1));
        }

        if (key.return) {
          if (typeof onSelect === "function") {
            onSelect(paginatedItems[selectedIndex]!);
          }
        }
      },
      [
        isFocused,
        isPaginated,
        totalPages,
        selectedIndex,
        paginatedItems,
        onSelect,
        onHighlight,
      ],
    ),
    { isActive: isFocused },
  );

  return (
    <Box flexDirection="column">
      {paginatedItems.map((item, index) => {
        const isSelected = index === selectedIndex;

        return (
          <Box key={item.key ?? String(item.value)}>
            {React.createElement(indicatorComponent, { isSelected, theme })}
            {React.createElement(itemComponent, { ...item, isSelected, theme })}
          </Box>
        );
      })}

      {isPaginated && (
        <Box marginTop={1} justifyContent="center">
          <Text dimColor>
            ‹ Page {currentPage + 1} of {totalPages} ›
          </Text>
        </Box>
      )}
    </Box>
  );
}
export default SelectInput;
