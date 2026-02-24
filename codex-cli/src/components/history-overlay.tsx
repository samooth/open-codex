import React, { useMemo } from "react";
import { Box, Text, useInput } from "ink";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import type { Theme } from "../utils/theme.js";
import TerminalChatResponseItem from "./chat/terminal-chat-response-item.js";

export default function HistoryOverlay({
  items,
  onExit,
  theme,
}: {
  items: Array<ChatCompletionMessageParam>;
  onExit: () => void;
  theme: Theme;
}) {
  useInput((_input, key) => {
    if (key.escape) onExit();
  });

  const toolCallMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of items) {
      if (item.role === "assistant" && item.tool_calls) {
        for (const tc of item.tool_calls) {
          map.set(tc.id, tc);
        }
      }
    }
    return map;
  }, [items]);

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
          <Text bold color="black"> HISTORY </Text>
        </Box>
        <Text color={theme.highlight} bold>SESSION TRANSCRIPT</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1} overflowY="hidden">
        {items.length === 0 ? (
          <Text italic color={theme.dim}>No history yet.</Text>
        ) : (
          items.slice(-10).map((item, i) => (
            <Box key={i} flexDirection="column" marginBottom={1}>
              <TerminalChatResponseItem
                item={item}
                fullStdout={false}
                toolCallMap={toolCallMap}
                theme={theme}
                model=""
                isActive={false}
              />
            </Box>
          ))
        )}
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
        <Text dimColor italic>Showing last 10 messages │ esc close</Text>
      </Box>
    </Box>
  );
}
