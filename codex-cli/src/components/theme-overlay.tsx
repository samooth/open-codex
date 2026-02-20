import { themes, getTheme } from "../utils/theme.js";
import TypeaheadOverlay from "./typeahead-overlay.js";
import { Text } from "ink";
import React from "react";
import type { Theme } from "../utils/theme.js";

type Props = {
  currentTheme: string;
  onSelect: (theme: string) => void;
  onExit: () => void;
  theme: Theme;
};

export default function ThemeOverlay({
  currentTheme,
  onSelect,
  onExit,
  theme: activeTheme,
}: Props): JSX.Element {
  const items = Object.keys(themes).map((t) => ({
    label: themes[t]!.name,
    value: t,
  }));

  const theme = getTheme(currentTheme);

  return (
    <TypeaheadOverlay
      title="Switch theme"
      description={
        <Text color={activeTheme.dim}>
          CURRENT THEME: <Text color={activeTheme.success} bold>{theme.name}</Text>
        </Text>
      }
      initialItems={items}
      currentValue={currentTheme}
      onSelect={onSelect}
      onExit={onExit}
      theme={activeTheme}
    />
  );
}
