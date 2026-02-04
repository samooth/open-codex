import type { ApprovalPolicy } from "../../approvals.js";
import type { Theme } from "../../utils/theme.js";
import { Box, Text } from "ink";
import React from "react";

type Props = {
  model: string;
  provider: string;
  contextLeftPercent: number;
  sessionId: string;
  approvalPolicy: ApprovalPolicy;
  theme: Theme;
};

const TerminalStatusBar: React.FC<Props> = ({
  model,
  provider,
  contextLeftPercent,
  sessionId,
  approvalPolicy,
  theme,
}) => {
  const shortSessionId = sessionId.slice(0, 8);
  const usedPercent = 100 - contextLeftPercent;
  
  // Visual progress bar
  const barWidth = 10;
  const filledWidth = Math.round((contextLeftPercent / 100) * barWidth);
  const bar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

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
    <Box
      width="100%"
      borderStyle="single"
      borderColor={theme.dim}
      paddingX={1}
      gap={2}
      flexDirection="row"
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text color={theme.statusBarModel} bold>
          {model}
        </Text>
        <Text color={theme.dim}>({provider})</Text>
      </Box>

      <Box gap={1}>
        <Text color={theme.dim}>Mode:</Text>
        <Text color={getPolicyColor(approvalPolicy)} bold>
          {approvalPolicy}
        </Text>
      </Box>

      <Box gap={1}>
        <Text color={theme.dim}>Context:</Text>
        <Text color={getContextColor(contextLeftPercent)}>
          {bar} {Math.round(contextLeftPercent)}%
        </Text>
      </Box>

      <Box gap={1}>
        <Text color={theme.dim}>Session:</Text>
        <Text color={theme.statusBarSession}>{shortSessionId}</Text>
      </Box>
    </Box>
  );
};

export default React.memo(TerminalStatusBar);
