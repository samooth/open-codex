import type { ApprovalPolicy } from "../../approvals.js";
import type { Theme } from "../../utils/theme.js";
import type { TokenBreakdown } from "../../utils/approximate-tokens-used.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

type Props = {
  model: string;
  provider: string;
  contextLeftPercent: number;
  tokenBreakdown: TokenBreakdown;
  sessionId: string;
  approvalPolicy: ApprovalPolicy;
  theme: Theme;
  queuedPromptsCount: number;
};

const TerminalStatusBar: React.FC<Props> = ({
  model,
  provider,
  contextLeftPercent,
  tokenBreakdown,
  sessionId,
  approvalPolicy,
  theme,
  queuedPromptsCount,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const shortSessionId = sessionId.slice(0, 8);
  
  // Visual progress bar
  const barWidth = 10;
  const filledWidth = Math.round(((100 - contextLeftPercent) / 100) * barWidth);
  const bar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

  useInput((_input, key) => {
    if (key.ctrl && _input === "b") {
      setShowBreakdown(!showBreakdown);
    }
  });

  const getPolicyColor = (policy: ApprovalPolicy) => {
    switch (policy) {
      case "full-auto":
        return theme.success;
      case "auto-edit":
        return theme.warning;
      default:
        return theme.user;
    }
  };

  const getContextColor = (percent: number) => {
    if (percent < 20) return theme.error;
    if (percent < 50) return theme.warning;
    return theme.success;
  };

  return (
    <Box flexDirection="column" marginTop={0}>
      <Box
        width="100%"
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <Box gap={1}>
          <Text color={theme.statusBarModel} bold>
            {model}
          </Text>
          <Text color={theme.dim}>({provider})</Text>
          <Text color={theme.dim}>|</Text>
          <Text color={theme.dim}>Mode:</Text>
          <Text color={getPolicyColor(approvalPolicy)} bold>
            {approvalPolicy}
          </Text>
          {queuedPromptsCount > 0 && (
            <>
              <Text color={theme.dim}>|</Text>
              <Text color="yellow" bold>
                {queuedPromptsCount} queued
              </Text>
            </>
          )}
        </Box>

        <Box gap={1}>
          {showBreakdown ? (
            <Box gap={1}>
              <Text dimColor>SYS:</Text>
              <Text color={theme.highlight}>{tokenBreakdown.system}</Text>
              <Text dimColor>HST:</Text>
              <Text color={theme.highlight}>{tokenBreakdown.history}</Text>
              <Text dimColor>TLS:</Text>
              <Text color={theme.highlight}>{tokenBreakdown.tools}</Text>
              <Text dimColor>TOT:</Text>
              <Text color={getContextColor(contextLeftPercent)}>{tokenBreakdown.total}</Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Text dimColor>Context:</Text>
              <Text color={getContextColor(contextLeftPercent)}>
                {bar} {Math.round(100 - contextLeftPercent)}%
              </Text>
            </Box>
          )}
          <Text color={theme.dim}>|</Text>
          <Text color={theme.dim}>ID:</Text>
          <Text color={theme.statusBarSession}>{shortSessionId}</Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text dimColor italic>
          ctrl+c exit | ctrl+b breakdown | /clear reset | /help commands | /model switch | /approval mode
        </Text>
      </Box>
    </Box>
  );
};

export default React.memo(TerminalStatusBar);
