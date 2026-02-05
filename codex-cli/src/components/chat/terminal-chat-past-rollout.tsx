import type { TerminalChatSession } from "../../utils/session.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import TerminalChatResponseItem from "./terminal-chat-response-item";
import { Box, Text } from "ink";
import React from "react";
import type { Theme } from "../../utils/theme.js";

export default function TerminalChatPastRollout({
  session,
  items,
  theme,
}: {
  session: TerminalChatSession;
  items: Array<ChatCompletionMessageParam>;
  theme: Theme;
}): React.ReactElement {
  const { version, id: sessionId, model } = session;
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" paddingX={1} width={64}>
        <Text>
          ● <Text bold>OpenCodex</Text>{" "}
          <Text color="blueBright">v{version}</Text>
        </Text>
      </Box>
      <Box
        borderStyle="round"
        borderColor="gray"
        paddingX={1}
        width={64}
        flexDirection="column"
      >
        <Text>
          <Text color="magenta">●</Text> localhost{" "}
          <Text dimColor>· session:</Text>{" "}
          <Text color="magentaBright" dimColor>
            {sessionId}
          </Text>
        </Text>
        <Text dimColor>
          <Text color="blueBright">↳</Text> When / Who:{" "}
          <Text bold>
            {session.timestamp} <Text dimColor>/</Text> {session.user}
          </Text>
        </Text>
        <Text dimColor>
          <Text color="blueBright">↳</Text> model: <Text bold>{model}</Text>
        </Text>
      </Box>
      <Box flexDirection="column" gap={1}>
        {React.useMemo(() => {
          const map = new Map<string, any>();
          for (const item of items) {
            if (item.role === "assistant" && item.tool_calls) {
              for (const tc of item.tool_calls) {
                map.set(tc.id, tc);
              }
            }
          }
          return items.map((item, key) => (
            <TerminalChatResponseItem
              key={key}
              item={item}
              toolCallMap={map}
              theme={theme}
            />
          ));
        }, [items, theme])}
      </Box>
    </Box>
  );
}
