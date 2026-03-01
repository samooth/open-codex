import type { ApprovalPolicy } from "../../approvals.js";
import type { TokenBreakdown } from "../../utils/approximate-tokens-used.js";
import type { Theme } from "../../utils/theme.js";

import { Sparkline } from "./sparkline.js";
import { useTerminalSizeContext } from "../../contexts/terminal-size-context.js";
import Spinner from "../vendor/ink-spinner.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

type Props = {
  contextLeftPercent: number;
  contextHistory: Array<number>;
  tokenBreakdown: TokenBreakdown;
  sessionId: string;
  approvalPolicy: ApprovalPolicy;
  theme: Theme;
  queuedInputLength: number;
  indexingStatus?: {
    indexing: boolean;
    current?: number;
    total?: number;
    file?: string;
  };
};

const TerminalStatusBar: React.FC<Props> = ({
  contextLeftPercent,
  contextHistory,
  tokenBreakdown,
  sessionId,
  approvalPolicy,
  theme,
  queuedInputLength,
  indexingStatus,
}) => {
  const [showBreakdown, setShowBreakdown] = useState(false);
  const { columns } = useTerminalSizeContext();
  const shortSessionId = sessionId.slice(0, 8);

  const usedPercent = 100 - contextLeftPercent;
  const isNarrow = columns < 80;
  const isUltraNarrow = columns < 60;

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
    if (percent > 80) {
      return theme.error;
    }
    if (percent > 60) {
      return theme.warning;
    }
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
    >
      <Box flexDirection="row" justifyContent="space-between">
        <Box gap={1}>
          {!isUltraNarrow && (
            <>
              <Text color={theme.accent} bold>
                ID:
              </Text>
              <Text color={theme.statusBarSession}>{shortSessionId}</Text>
              {separator}
            </>
          )}
          <Text color={theme.accent} bold>
            {isNarrow ? "M:" : "MODE:"}
          </Text>
          <Text color={getPolicyColor(approvalPolicy)}>
            {isNarrow
              ? approvalPolicy.slice(0, 1).toUpperCase()
              : approvalPolicy.toUpperCase()}
          </Text>

          {indexingStatus?.indexing && (
            <>
              {separator}
              <Spinner type="dots" color={theme.highlight} />
              {!isNarrow && (
                <Text color={theme.dim}>
                  INDEXING
                  {indexingStatus.current
                    ? ` [${indexingStatus.current}/${indexingStatus.total}]`
                    : ""}
                </Text>
              )}
            </>
          )}

          {queuedInputLength > 0 && !isNarrow && (
            <>
              {separator}
              <Text color="yellow" bold>
                QUEUED: {queuedInputLength}c
              </Text>
            </>
          )}
        </Box>

        <Box gap={1}>
          {showBreakdown ? (
            <Box gap={1}>
              <Text color={theme.assistant}>
                {isNarrow ? "S" : "SYS"}:{tokenBreakdown.system}
              </Text>
              <Text color={theme.user}>
                {isNarrow ? "H" : "HIST"}:{tokenBreakdown.history}
              </Text>
              <Text color={theme.highlight}>
                {isNarrow ? "T" : "TOOL"}:{tokenBreakdown.tools}
              </Text>
              <Text color={theme.dim}>/</Text>
              <Text color={theme.success} bold>
                {isNarrow ? "Σ" : "TOTAL"}:{tokenBreakdown.total}
              </Text>
              {separator}
              <Text color={theme.warning}>
                ${tokenBreakdown.cost.toFixed(4)}
              </Text>
            </Box>
          ) : (
            <Box gap={1}>
              <Text color={theme.warning}>
                ${tokenBreakdown.cost.toFixed(4)}
              </Text>
              {separator}
              {!isNarrow && <Text color={theme.dim}>CONTEXT</Text>}
              {!isUltraNarrow && (
                <Sparkline
                  data={contextHistory}
                  color={getContextColor(usedPercent)}
                />
              )}
              <Text color={getContextColor(usedPercent)}>
                {Math.round(usedPercent)}%
              </Text>
            </Box>
          )}
          {!isNarrow && (
            <>
              {separator}
              <Text color={theme.dim}>ctrl+b info</Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

export default React.memo(TerminalStatusBar);
