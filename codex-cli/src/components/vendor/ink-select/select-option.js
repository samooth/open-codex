import React from "react";
import { Box, Text } from "ink";
import figures from "figures";
import { styles } from "./theme";
export function SelectOption({ isFocused, isSelected, children, theme }) {
  return React.createElement(
    Box,
    { ...styles.option({ isFocused }) },
    isFocused &&
      React.createElement(
        Text,
        { ...styles.focusIndicator({ theme }) },
        figures.pointer,
      ),
    React.createElement(
      Text,
      { ...styles.label({ isFocused, isSelected, theme }) },
      children,
    ),
    isSelected &&
      React.createElement(
        Text,
        { ...styles.selectedIndicator({ theme }) },
        figures.tick,
      ),
  );
}
