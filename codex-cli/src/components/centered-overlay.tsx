import type { Theme } from "../utils/theme.js";

import { useTerminalSizeContext } from "../contexts/terminal-size-context.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

type Props = {
  title: string;
  description?: string;
  footer?: string;
  width?: number;
  theme: Theme;
  onExit: () => void;
  children: React.ReactNode;
};

/**
 * Kilo-style centered dialog: full border, title row, optional description
 * and a footer hint bar. This is the TUI equivalent of Kilo's
 * `dialog.css` — `align-items: center`, `width: min(100vw - 16px, 640px)`,
 * title 16-medium, footer separated by a hairline.
 *
 * Closes on Escape by default (mirrors `dialog-overlay` click-away).
 */
export default function CenteredOverlay({
  title,
  description,
  footer,
  width,
  theme,
  onExit,
  children,
}: Props): React.ReactElement {
  const { columns } = useTerminalSizeContext();
  const [handledEscape, setHandledEscape] = useState(false);

  useInput(
    (_input, key) => {
      if (key.escape && !handledEscape) {
        setHandledEscape(true);
        onExit();
      }
    },
    { isActive: true },
  );

  const boxWidth = Math.min(width ?? 64, columns - 4);

  return (
    <Box flexDirection="row" justifyContent="center" marginY={1}>
      <Box
        flexDirection="column"
        width={boxWidth}
        borderStyle="single"
        borderColor={theme.divider}
      >
        <Box paddingX={2} paddingTop={1} gap={1}>
          <Text color={theme.highlight} bold>
            {title}
          </Text>
        </Box>
        {description && (
          <Box paddingX={2}>
            <Text color={theme.dim}>{description}</Text>
          </Box>
        )}
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {children}
        </Box>
        <Box
          borderTop
          borderStyle="single"
          borderTopColor={theme.divider}
          paddingX={2}
          paddingY={0}
        >
          <Text color={theme.dim}>{footer ?? "esc close"}</Text>
        </Box>
      </Box>
    </Box>
  );
}
