import type { Theme } from "../utils/theme.js";

import fs from "fs";
import { Box, Text, useInput } from "ink";
import path from "path";
import React, { useState, useEffect } from "react";

export default function MemoryOverlay({
  onExit,
  theme,
}: {
  onExit: () => void;
  theme: Theme;
}) {
  const [content, setContent] = useState<string>("");
  const memoryPath = path.join(process.cwd(), ".codex", "memory.md");

  useEffect(() => {
    if (fs.existsSync(memoryPath)) {
      setContent(fs.readFileSync(memoryPath, "utf-8"));
    } else {
      setContent("No project memory found for this repository.");
    }
  }, [memoryPath]);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
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
      width={80}
      height={20}
      marginY={1}
    >
      <Box gap={1} marginBottom={1}>
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black">
            {" "}
            MEMORY{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          PERSISTENT PROJECT KNOWLEDGE
        </Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflowY="hidden" paddingX={1}>
        <Text color={theme.dim}>{content}</Text>
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
          esc close
        </Text>
      </Box>
    </Box>
  );
}
