import React from "react";
import type { ApprovalPolicy } from "../approvals.js";
import type { Theme } from "../utils/theme.js";
import TypeaheadOverlay from "./typeahead-overlay.js";

type Props = {
  currentMode: ApprovalPolicy;
  onSelect: (mode: string) => void;
  onExit: () => void;
  theme: Theme;
};

const modes = [
  { label: "SUGGEST - Human confirms all edits and commands", value: "suggest", description: "Default safe mode. Confirm everything." },
  { label: "AUTO-EDIT - confirms shell, but files are edited automatically", value: "auto-edit", description: "Speeds up coding turns while keeping control of execution." },
  { label: "FULL-AUTO - confirmations disabled (DANGER: sandbox recommended)", value: "full-auto", description: "Highest autonomy. Use with caution in sandboxed environments." },
];

export default function ApprovalModeOverlay({
  currentMode,
  onSelect,
  onExit,
  theme,
}: Props): React.ReactElement {
  const options = modes.map(m => ({
    ...m,
    label: `${m.value === currentMode ? "❯ " : "  "}${m.label}`
  }));

  return (
    <TypeaheadOverlay
      title="SET APPROVAL MODE"
      items={options}
      onSelect={onSelect as any}
      onExit={onExit}
      theme={theme}
    />
  );
}
