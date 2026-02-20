import TypeaheadOverlay from "./typeahead-overlay.js";
import { AutoApprovalMode } from "../utils/auto-approval-mode.js";
import { Text } from "ink";
import React from "react";
import type { Theme } from "../utils/theme.js";

type Props = {
  currentMode: string;
  onSelect: (mode: string) => void;
  onExit: () => void;
  theme: Theme;
};

/**
 * Overlay to switch between the different automatic‑approval policies.
 */
export default function ApprovalModeOverlay({
  currentMode,
  onSelect,
  onExit,
  theme,
}: Props): JSX.Element {
  const items = React.useMemo(
    () =>
      Object.values(AutoApprovalMode).map((m) => ({
        label: m,
        value: m,
      })),
    [],
  );

  return (
    <TypeaheadOverlay
      title="Switch approval mode"
      description={
        <Text color={theme.dim}>
          CURRENT MODE: <Text color={theme.success} bold>{currentMode}</Text>
        </Text>
      }
      initialItems={items}
      currentValue={currentMode}
      onSelect={onSelect}
      onExit={onExit}
      theme={theme}
    />
  );
}
