import type { Theme } from "../utils/theme.js";

import TypeaheadOverlay from "./typeahead-overlay.js";
import { themes } from "../utils/theme.js";
import React from "react";

type Props = {
  currentTheme: string;
  onSelect: (theme: string) => void;
  onExit: () => void;
  theme: Theme;
};

const options = Object.keys(themes).map((name) => ({
  label: name.toUpperCase(),
  value: name,
  description: (themes[name] as any)?.description || `Select the ${name} theme`,
}));

export default function ThemeOverlay({
  currentTheme,
  onSelect,
  onExit,
  theme,
}: Props): React.ReactElement {
  const themeOptions = options.map((o) => ({
    ...o,
    label: `${o.value === currentTheme ? "❯ " : "  "}${o.label}`,
  }));

  return (
    <TypeaheadOverlay
      title="SELECT THEME"
      items={themeOptions}
      onSelect={onSelect as any}
      onExit={onExit}
      theme={theme}
    />
  );
}
