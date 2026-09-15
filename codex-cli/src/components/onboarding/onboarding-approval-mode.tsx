import type { Theme } from "../../utils/theme.js";

import { useAppContext } from "../../contexts/app-context.js";
import { AutoApprovalMode } from "../../utils/auto-approval-mode.js";
import { saveConfig } from "../../utils/config.js";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "../vendor/ink-select/select";
import { Box, Text } from "ink";
import React from "react";

/**
 * First-run approval-mode picker. Selecting an option immediately applies
 * the mode to the app config (and persists it), so the choice actually
 * takes effect instead of being silently dropped.
 */
export function OnboardingApprovalMode({
  theme,
  onSelect,
}: {
  theme: Theme;
  onSelect?: (mode: AutoApprovalMode) => void;
}): React.ReactElement {
  const { config, setConfig } = useAppContext();

  const handleSelect = (value: AutoApprovalMode) => {
    setConfig((prev) => ({ ...prev, approvalMode: value }));
    try {
      saveConfig({ ...config, approvalMode: value });
    } catch {
      // Persistence is best-effort; the runtime change above still applies.
    }
    onSelect?.(value);
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      paddingLeft={1}
      marginY={1}
    >
      <Box gap={1} marginBottom={1}>
        <Box
          backgroundColor={theme.highlight as unknown as string}
          paddingX={1}
        >
          <Text bold color="black">
            {" "}
            SETUP{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          Choose what you want to have to approve:
        </Text>
      </Box>
      <Box paddingLeft={2}>
        <Select
          theme={theme}
          onChange={handleSelect}
          options={[
            {
              label: "Auto-approve file reads, but ask me for edits and commands",
              value: AutoApprovalMode.SUGGEST,
            },
            {
              label: "Auto-approve file reads and edits, but ask me for commands",
              value: AutoApprovalMode.AUTO_EDIT,
            },
            {
              label:
                "Auto-approve file reads, edits, and running commands network-disabled",
              value: AutoApprovalMode.FULL_AUTO,
            },
          ]}
        />
      </Box>
    </Box>
  );
}
