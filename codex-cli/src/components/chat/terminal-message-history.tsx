import type { TerminalHeaderProps } from "./terminal-header.js";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import TerminalChatResponseItem from "./terminal-chat-response-item.js";
import TerminalHeader from "./terminal-header.js";
import ThinkingTimer from "./thinking-timer.js";
import { Box, Static } from "ink";
import React, { useMemo } from "react";
import type { Theme } from "../../utils/theme.js";

// A batch entry can either be a standalone response item or a grouped set of
// items (e.g. auto‑approved tool‑call batches) that should be rendered
// together.
type BatchEntry = {
  item?: ChatCompletionMessageParam;
  group?: GroupedResponseItem;
};
type MessageHistoryProps = {
  batch: Array<BatchEntry>;
  groupCounts: Record<string, number>;
  items: Array<ChatCompletionMessageParam>;
  userMsgCount: number;
  confirmationPrompt: React.ReactNode;
  loading: boolean;
  headerProps: TerminalHeaderProps;
  fullStdout: boolean;
  theme: Theme;
  streamingMessage?: ChatCompletionMessageParam;
};

const MessageHistory: React.FC<MessageHistoryProps> = ({
  batch,
  items,
  headerProps,
  loading,
  fullStdout,
  theme,
  streamingMessage,
}) => {
  const [messages, debug, toolCallMap] = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of items) {
      if (item.role === "assistant" && item.tool_calls) {
        for (const tc of item.tool_calls) {
          map.set(tc.id, tc);
        }
      }
    }
    return [batch, process.env["DEBUG"], map];
  }, [batch, items]);

  return (
    <Box flexDirection="column">
      <Static key={theme.name} items={["header", ...messages]}>
        {(entry, index) => {
          if (entry === "header") {
            return <TerminalHeader key="header" {...headerProps} theme={theme} />;
          }
          const { item, group } = entry as BatchEntry;
          const role = item?.role || (group?.items[0] as any)?.role;

          return (
            <Box
              key={index}
              flexDirection="column"
              marginLeft={role === "user" ? 0 : 4}
              marginTop={0}
            >
              <TerminalChatResponseItem
                item={item!}
                group={group}
                fullStdout={fullStdout}
                toolCallMap={toolCallMap}
                loading={false}
                theme={theme}
              />
            </Box>
          );
        }}
      </Static>
      {streamingMessage && (
        <Box
          flexDirection="column"
          marginLeft={4}
          marginTop={1}
        >
          <TerminalChatResponseItem
            item={streamingMessage}
            fullStdout={fullStdout}
            toolCallMap={toolCallMap}
            loading={loading}
            theme={theme}
          />
        </Box>
      )}
      {loading && debug && (
        <Box marginTop={1} marginLeft={4}>
          <ThinkingTimer loading={loading} theme={theme} />
        </Box>
      )}
    </Box>
  );
};

export default React.memo(MessageHistory);
