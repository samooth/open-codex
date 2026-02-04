import { themes, getTheme } from "../utils/theme.js";
import TypeaheadOverlay from "./typeahead-overlay.js";
import { Text } from "ink";
import React from "react";

type Props = {
  currentTheme: string;
  onSelect: (theme: string) => void;
  onExit: () => void;
};

export default function ThemeOverlay({
  currentTheme,
  onSelect,
  onExit,
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
        <Text>
          Current theme: <Text color={theme.assistant}>{theme.name}</Text>
        </Text>
      }
      initialItems={items}
      currentValue={currentTheme}
      onSelect={onSelect}
      onExit={onExit}
    />
  );
}
