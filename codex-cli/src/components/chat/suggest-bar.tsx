import type { Theme } from "../../utils/theme.js";

import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

/**
 * Follow-up suggestions shown right after the agent finishes a turn,
 * mirroring Kilo's SuggestBar. Tab cycles, Enter sends, any other input
 * dismisses (control returns to the main prompt input).
 */
export default function SuggestBar({
  suggestions,
  theme,
  onAccept,
  onDismiss,
  isActive,
}: {
  suggestions: Array<string>;
  theme: Theme;
  onAccept: (text: string) => void;
  onDismiss: () => void;
  isActive: boolean;
}): React.ReactElement | null {
  const [index, setIndex] = useState(0);
  const count = suggestions.length;

  useInput(
    (input, key) => {
      if (!isActive || count === 0) {
        return;
      }
      if (key.tab || key.rightArrow) {
        setIndex((i) => (i + 1) % count);
      } else if (key.leftArrow) {
        setIndex((i) => (i - 1 + count) % count);
      } else if (key.return) {
        onAccept(suggestions[index] ?? "");
      } else if (key.escape || (input && !key.tab && !key.return)) {
        // Any typing intent (or Esc) hands focus back to the prompt.
        onDismiss();
      }
    },
    { isActive },
  );

  if (count === 0) {
    return null;
  }

  return (
    <Box flexDirection="row" gap={1} paddingX={2} marginTop={1}>
      <Text color={theme.dim}>✦ next</Text>
      {suggestions.map((s, i) => (
        <Box key={s} gap={0}>
          <Text
            color={i === index ? theme.highlight : theme.dim}
            bold={i === index}
            underline={i === index}
          >
            {i === index ? " ❯" : "  "}
            {s}
          </Text>
        </Box>
      ))}
      <Text color={theme.dim}>tab cycle · enter send · type to dismiss</Text>
    </Box>
  );
}
