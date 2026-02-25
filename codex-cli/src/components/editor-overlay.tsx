import type { Theme } from "../utils/theme.js";

import TextInput from "./vendor/ink-text-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";


export default function EditorOverlay({
  currentCommand,
  onSave,
  onExit,
  theme,
}: {
  currentCommand: string;
  onRefresh?: () => void;
  onSave: (command: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [command, setCommand] = useState(currentCommand);

  useInput((_input, key) => {
    if (key.escape) {onExit();}
    if (key.return) {onSave(command.trim());}
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
      width={80}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black"> EDITOR </Text>
        </Box>
        <Text color={theme.highlight} bold>CONFIGURE EXTERNAL EDITOR</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={theme.highlight} bold>COMMAND: </Text>
          <TextInput
            value={command}
            onChange={setCommand}
            placeholder="e.g. code --wait, nvim, vim, etc."
          />
        </Box>
        
        <Text color={theme.dim}>
          This command will be used when you press Ctrl+E in the chat.
          If empty, it will default to $EDITOR or $VISUAL environment variables.
        </Text>
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
        <Text dimColor italic>enter save │ esc close</Text>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>
          Tip: Use a command that blocks the terminal (like 'code --wait') 
          so OpenCodex knows when you're done editing.
        </Text>
      </Box>
    </Box>
  );
}
