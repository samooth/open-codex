import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "./vendor/ink-text-input.js";
import type { Theme } from "../utils/theme.js";

export default function SearchUrlOverlay({
  title,
  currentUrl,
  onSave,
  onExit,
  theme,
}: {
  title: string;
  currentUrl: string;
  onRefresh?: () => void;
  onSave: (url: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [url, setUrl] = useState(currentUrl);

  useInput((_input, key) => {
    if (key.escape) onExit();
    if (key.return) onSave(url.trim());
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
          <Text bold color="black"> {title} </Text>
        </Box>
        <Text color={theme.highlight} bold>CONFIGURE SEARCH URL</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={theme.highlight} bold>URL: </Text>
          <TextInput
            value={url}
            onChange={setUrl}
            placeholder="https://..."
          />
        </Box>
        
        <Text color={theme.dim}>
          Enter the base URL for the search provider. 
          For SearXNG, it should be the instance root.
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
          Tip: If left empty, the system will fall back to default search providers.
        </Text>
      </Box>
    </Box>
  );
}
