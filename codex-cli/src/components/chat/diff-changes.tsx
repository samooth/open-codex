import type { Theme } from "../../utils/theme.js";

import { Box, Text } from "ink";
import React from "react";

/**
 * Kilo-style diff counter: colored "+N -M" plus a 5-block mini bar
 * proportional to the add/delete ratio (see DiffChanges.tsx "bars" variant).
 * Falls back to a plain counter when the bar wouldn't add information.
 */
export function DiffChanges({
  additions,
  deletions,
  theme,
  showBar = true,
}: {
  additions: number;
  deletions: number;
  theme: Theme;
  showBar?: boolean;
}): React.ReactElement {
  const total = additions + deletions;
  if (total === 0) {
    return <Text color={theme.dim}>no changes</Text>;
  }

  let addedBlocks = 0;
  let deletedBlocks = 0;
  if (showBar) {
    const BLOCKS = 5;
    if (total < 5) {
      addedBlocks = additions > 0 ? 1 : 0;
      deletedBlocks = deletions > 0 ? 1 : 0;
    } else {
      const pctAdd = additions / total;
      addedBlocks = additions > 0 ? Math.max(1, Math.round(pctAdd * BLOCKS)) : 0;
      deletedBlocks = deletions > 0
        ? Math.max(0, Math.min(BLOCKS - addedBlocks, Math.round((1 - pctAdd) * BLOCKS)))
        : 0;
    }
  }

  return (
    <Box gap={0}>
      <Text color={theme.success}>+{additions} </Text>
      <Text color={theme.error}>-{deletions}</Text>
      {showBar && (addedBlocks > 0 || deletedBlocks > 0) && (
        <Text>
          <Text color={theme.dim}> </Text>
          <Text color={theme.success}>{"▮".repeat(Math.min(5, addedBlocks))}</Text>
          <Text color={theme.error}>{"▮".repeat(Math.min(5, deletedBlocks))}</Text>
        </Text>
      )}
    </Box>
  );
}
