import type { Theme } from "../utils/theme.js";

import TextInput from "./vendor/ink-text-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export default function PromptOverlay({
  currentInstructions,
  onSave,
  onExit,
  theme,
}: {
  currentInstructions: string;
  onRefresh?: () => void;
  onSave: (instructions: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [instructions, setInstructions] = useState(currentInstructions);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
    if (key.return) {
      onSave(instructions.trim());
    }
  });

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={100}
      height={20}
      marginY={1}
    >
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black">
            {" "}
            PROMPT{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          EDIT SYSTEM INSTRUCTIONS
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        <TextInput
          value={instructions}
          onChange={setInstructions}
          placeholder="Enter custom instructions..."
        />
      </Box>

      <Box
        borderStyle="single"
        borderRight={false}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderTopColor={theme.divider}
        paddingX={1}
        paddingTop={1}
      >
        <Text dimColor italic>
          enter save │ esc close
        </Text>
      </Box>
    </Box>
  );
}
