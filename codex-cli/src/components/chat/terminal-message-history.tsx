import type { ApplyPatchCommand } from "../../approvals.js";
import type { TerminalHeaderProps } from "./terminal-header.js";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import TerminalChatResponseItem from "./terminal-chat-response-item.js";
import { TerminalChatCommandReview } from "./terminal-chat-command-review.js";
import TerminalHeader from "./terminal-header.js";
import ThinkingTimer from "./thinking-timer.js";
import { Box, Static } from "ink";
import React, { useMemo } from "react";
import type { ReviewDecision } from "../../utils/agent/review.js";
import type { Theme } from "../../utils/theme.js";

// A batch entry can either be a standalone response item or a grouped set of
// items (e.g. auto‑approved tool‑call batches) that should be rendered
// together.
export type BatchEntry = {
  item?: ChatCompletionMessageParam;
  group?: GroupedResponseItem;
};

type MessageHistoryProps = {
  committedBatches: Array<BatchEntry>;
  turnBatches: Array<BatchEntry>;
  toolCallMap: Map<string, any>;
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
  height?: number;
  historyKey?: number;
};

const MessageHistory: React.FC<MessageHistoryProps> = ({
  committedBatches,
  turnBatches,
  toolCallMap,
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
  height = 20,
  historyKey = 0,
}) => {
  const [debug] = useMemo(() => {
    return [process.env["DEBUG"]];
  }, []);

  // Constrain turn batches to fit within height
  const displayedTurnBatches = useMemo(() => {
    if (turnBatches.length <= 3) return turnBatches;
    // Only show last few batches if we have many in the current turn
    return turnBatches.slice(-3);
  }, [turnBatches]);

  return (
    <Box flexDirection="column">
      <Static key={`${theme.name}-${historyKey}`} items={["header", ...committedBatches]}>
        {(entry, index) => {
          if (entry === "header") {
            return <TerminalHeader key="header" {...headerProps} theme={theme} />;
          }
          const { item, group } = entry as BatchEntry;
          const role = item?.role || (group?.items[0] as any)?.role;

          // Find the role of the previous message to determine if we should show the header
          let previousRole: string | undefined;
          if (index > 1) { // messages start at index 1 because index 0 is "header"
            const prevEntry = committedBatches[index - 2];
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

      {/* Render items from the current turn normally (not in Static) */}
      <Box flexDirection="column" height={height} overflow="hidden">
        {displayedTurnBatches.map((entry, index) => {
          const { item, group } = entry;
          const role = item?.role || (group?.items[0] as any)?.role;

          // Determine previous role for consistent header suppression
          let previousRole: string | undefined;
          if (index > 0) {
            const prevEntry = displayedTurnBatches[index - 1];
            previousRole = prevEntry?.item?.role || (prevEntry?.group?.items[0] as any)?.role;
          } else if (committedBatches.length > 0) {
            const lastCommitted = committedBatches[committedBatches.length - 1];
            previousRole = lastCommitted?.item?.role || (lastCommitted?.group?.items[0] as any)?.role;
          }

          return (
            <Box
              key={`turn-${index}`}
              flexDirection="column"
              marginTop={role === "user" ? 1 : 0}
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
        })}

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
              if (displayedTurnBatches.length > 0) {
                const lastTurn = displayedTurnBatches[displayedTurnBatches.length - 1];
                return lastTurn?.item?.role || (lastTurn?.group?.items[0] as any)?.role;
              }
              if (committedBatches.length > 0) {
                const lastCommitted = committedBatches[committedBatches.length - 1];
                return lastCommitted?.item?.role || (lastCommitted?.group?.items[0] as any)?.role;
              }
              return undefined;
            })()}
          />
        )}
      </Box>

      {confirmationPrompt && (
        <Box height={height}>
          <TerminalChatCommandReview
            confirmationPrompt={confirmationPrompt}
            onReviewCommand={submitConfirmation}
            allowAlwaysPatch={allowAlwaysPatch}
            applyPatch={applyPatch}
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
  previousRole
}: { 
  message: ChatCompletionMessageParam; 
  loading: boolean; 
  theme: Theme; 
  fullStdout: boolean; 
  toolCallMap: Map<string, any>;
  model: string;
  showRole?: boolean;
  previousRole?: string;
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
      />
    </Box>
  );
});

export default React.memo(MessageHistory);
