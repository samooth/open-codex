import type { ApprovalPolicy } from "../../approvals.js";
import type { Theme } from "../../utils/theme.js";
import type { TokenBreakdown } from "../../utils/approximate-tokens-used.js";
import { Sparkline } from "./sparkline.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

type Props = {
  model: string;
  provider: string;
  contextLeftPercent: number;
  contextHistory: number[];
  tokenBreakdown: TokenBreakdown;
  sessionId: string;
  approvalPolicy: ApprovalPolicy;
  theme: Theme;
  queuedPromptsCount: number;
  queuedInputLength: number;
};

const TerminalStatusBar: React.FC<Props> = ({
  model,
  provider,
  contextLeftPercent,
  contextHistory,
  tokenBreakdown,
  sessionId,
  approvalPolicy,
  theme,
  queuedPromptsCount,
  queuedInputLength,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const shortSessionId = sessionId.slice(0, 8);
  
  const usedPercent = 100 - contextLeftPercent;

  useInput((_input, key) => {
    if (key.ctrl && _input === "b") {
      setShowBreakdown(!showBreakdown);
    }
  });

  const getPolicyColor = (policy: ApprovalPolicy) => {
    switch (policy) {
      case "full-auto": return theme.success;
      case "auto-edit": return theme.warning;
      default: return theme.user;
    }
  };

  const getContextColor = (percent: number) => {
    if (percent > 80) return theme.error;
    if (percent > 60) return theme.warning;
    return theme.success;
  };

  const separator = <Text color={theme.divider}> │ </Text>;

  return (
    <Box 
      flexDirection="column" 
      paddingX={1} 
      borderStyle="single" 
      borderBottom={false} 
      borderLeft={false} 
      borderRight={false} 
      borderTopColor={theme.divider}
      height={1}
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box gap={1}>
          <Text color={theme.accent} bold>ID:</Text>
          <Text color={theme.statusBarSession}>{shortSessionId}</Text>
          {separator}
          <Text color={theme.accent} bold>MODE:</Text>
          <Text color={getPolicyColor(approvalPolicy)}>{approvalPolicy.toUpperCase()}</Text>
          {queuedInputLength > 0 && (
            <>
              {separator}
              <Text color="yellow" bold>QUEUED: {queuedInputLength} chars</Text>
            </>
          )}
        </Box>

        <Box gap={1}>
          {showBreakdown ? (
            <Box gap={1}>
              <Text color={theme.assistant}>S:{tokenBreakdown.system}</Text>
              <Text color={theme.user}>H:{tokenBreakdown.history}</Text>
              <Text color={theme.highlight}>T:{tokenBreakdown.tools}</Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Text color={theme.dim}>CONTEXT</Text>
              <Sparkline data={contextHistory} color={getContextColor(usedPercent)} />
              <Text color={getContextColor(usedPercent)}>
                {Math.round(usedPercent)}%
              </Text>
            </Box>
          )}
          {separator}
          <Text color={theme.dim}>ctrl+h help</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(TerminalStatusBar);
