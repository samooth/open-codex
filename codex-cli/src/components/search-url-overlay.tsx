import type { Theme } from "../utils/theme.js";

import TextInput from "./vendor/ink-text-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";


export default function SearchUrlOverlay({
  title,
  subtitle = "CONFIGURE SEARCH URL",
  label = "URL: ",
  placeholder = "https://...",
  description = "Enter the base URL for the search provider.",
  currentUrl,
  onSave,
  onExit,
  theme,
}: {
  title: string;
  subtitle?: string;
  label?: string;
  placeholder?: string;
  description?: string;
  currentUrl: string;
  onRefresh?: () => void;
  onSave: (url: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [url, setUrl] = useState(currentUrl);

  useInput((_input, key) => {
    if (key.escape) {onExit();}
    if (key.return) {onSave(url.trim());}
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
        <Text color={theme.highlight} bold>{subtitle}</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Box gap={1} marginBottom={1}>
          <Text color={theme.highlight} bold>{label}</Text>
          <TextInput
            value={url}
            onChange={setUrl}
            placeholder={placeholder}
          />
        </Box>
        
        <Text color={theme.dim}>
          {description}
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
