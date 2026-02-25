import type { TerminalHeaderProps } from "./terminal-header.js";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { ApplyPatchCommand } from "../../approvals.js";
import type { ReviewDecision } from "../../utils/agent/review.js";
import type { AppConfig } from "../../utils/config.js";
import type { Theme } from "../../utils/theme.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { TerminalChatCommandReview } from "./terminal-chat-command-review.js";
import TerminalChatResponseItem from "./terminal-chat-response-item.js";
import TerminalHeader from "./terminal-header.js";
import ThinkingTimer from "./thinking-timer.js";
import { Box, Static } from "ink";
import React, { useMemo } from "react";

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
  model: string;
  confirmationPrompt: React.ReactNode;
  submitConfirmation: (decision: ReviewDecision, customDenyMessage?: string, updatedApplyPatch?: ApplyPatchCommand) => void;
  allowAlwaysPatch?: boolean;
  applyPatch?: ApplyPatchCommand;
  loading: boolean;
  headerProps: TerminalHeaderProps;
  fullStdout: boolean;
  theme: Theme;
  streamingMessage?: ChatCompletionMessageParam;
  lastFileAccess?: string;
  isActive?: boolean;
  refreshKey?: number;
  onRefresh?: () => void;
  config: AppConfig;
};

const MessageHistory: React.FC<MessageHistoryProps> = ({
  batch,
  items,
  headerProps,
  model,
  confirmationPrompt,
  submitConfirmation,
  allowAlwaysPatch,
  applyPatch,
  loading,
  fullStdout,
  theme,
  streamingMessage,
  lastFileAccess,
  isActive = true,
  refreshKey = 0,
  onRefresh,
  config,
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
      <Static key={`${theme.name}-${refreshKey}`} items={["header", ...messages]}>
        {(entry, index) => {
          if (entry === "header") {
            return <TerminalHeader key="header" {...headerProps} theme={theme} breadcrumb={lastFileAccess} />;
          }
          const { item, group } = entry as BatchEntry;
          const role = item?.role || (group?.items[0] as any)?.role;

          // Find the role of the previous message to determine if we should show the header
          let previousRole: string | undefined;
          if (index > 1) { // messages start at index 1 because index 0 is "header"
            const prevEntry = messages[index - 2];
            if (prevEntry) {
              previousRole = prevEntry.item?.role || (prevEntry.group?.items[0] as any)?.role;
            }
          }

          return (
            <Box
              key={index}
              flexDirection="column"
              marginTop={role === "user" && index > 1 ? 1 : 0}
            >
              <TerminalChatResponseItem
                item={item!}
                group={group}
                fullStdout={fullStdout}
                toolCallMap={toolCallMap}
                loading={false}
                theme={theme}
                model={model}
                previousRole={previousRole}
              />
            </Box>
          );
        }}
      </Static>
      {streamingMessage && (
        <StreamingAssistantResponse 
          message={streamingMessage}
          loading={loading}
          theme={theme}
          fullStdout={fullStdout}
          toolCallMap={toolCallMap}
          model={model}
          showRole={true}
          previousRole={(() => {
            const lastEntry = messages[messages.length - 1];
            if (lastEntry) {
              return lastEntry.item?.role || (lastEntry.group?.items[0] as any)?.role;
            }
            return undefined;
          })()}
          isActive={isActive}
        />
      )}
      {confirmationPrompt && (
        <Box>
          <TerminalChatCommandReview
            confirmationPrompt={confirmationPrompt}
            onReviewCommand={submitConfirmation}
            allowAlwaysPatch={allowAlwaysPatch}
            applyPatch={applyPatch}
            theme={theme}
            isActive={isActive}
            onRefresh={onRefresh}
            config={config}
          />
        </Box>
      )}
      {loading && !confirmationPrompt && debug && (
        <Box marginTop={1}>
          <ThinkingTimer loading={loading} theme={theme} />
        </Box>
      )}
    </Box>
  );
};

const StreamingAssistantResponse = React.memo(({ 
  message, 
  loading, 
  theme, 
  fullStdout, 
  toolCallMap,
  model,
  showRole = false,
  previousRole,
  isActive = false
}: { 
  message: ChatCompletionMessageParam; 
  loading: boolean; 
  theme: Theme; 
  fullStdout: boolean; 
  toolCallMap: Map<string, any>;
  model: string;
  showRole?: boolean;
  previousRole?: string;
  isActive?: boolean;
}) => {
  return (
    <Box
      flexDirection="column"
      marginTop={1}
    >
      <TerminalChatResponseItem
        item={message}
        fullStdout={fullStdout}
        toolCallMap={toolCallMap}
        loading={loading}
        theme={theme}
        model={model}
        showRole={showRole}
        previousRole={previousRole}
        isStreaming={true}
        isActive={isActive}
      />
    </Box>
  );
});

export default React.memo(MessageHistory);
