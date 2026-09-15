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
  contextSegments?: {
    usedPct: number;
    reservedPct: number;
    freePct: number;
  };
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
  contextSegments,
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
              <Text color={theme.dim}>id</Text>
              <Text color={theme.statusBarSession}>{shortSessionId}</Text>
              {separator}
            </>
          )}
          <Text color={theme.dim}>{isNarrow ? "m" : "mode"}</Text>
          <Text color={getPolicyColor(approvalPolicy)}>
            {approvalPolicy}
          </Text>

          {indexingStatus?.indexing && (
            <>
              {separator}
              <Spinner type="dots" color={theme.highlight} />
              {!isNarrow && (
                <Text color={theme.dim}>
                  indexing
                  {indexingStatus.total
                    ? ` ${Math.min(
                        100,
                        Math.round(
                          ((indexingStatus.current || 0) / indexingStatus.total) *
                            100,
                        ),
                      )}% (${indexingStatus.current || 0}/${indexingStatus.total})`
                    : indexingStatus.current
                      ? ` ${indexingStatus.current}`
                      : ""}
                </Text>
              )}
            </>
          )}

          {queuedInputLength > 0 && !isNarrow && (
            <>
              {separator}
              <Text color="yellow">
                queued {queuedInputLength}c
              </Text>
            </>
          )}
        </Box>

        <Box gap={1}>
          {showBreakdown ? (
            <Box gap={1}>
              <Text color={theme.dim}>
                {isNarrow ? "s" : "sys"}
                <Text color={theme.assistant}> {String(tokenBreakdown.system)}</Text>
              </Text>
              <Text color={theme.dim}>
                {isNarrow ? "h" : "hist"}
                <Text color={theme.user}> {String(tokenBreakdown.history)}</Text>
              </Text>
              <Text color={theme.dim}>
                {isNarrow ? "t" : "tool"}
                <Text color={theme.highlight}> {String(tokenBreakdown.tools)}</Text>
              </Text>
              <Text color={theme.success} bold>
                {String(tokenBreakdown.total)}t
              </Text>
              {!isUltraNarrow && (
                <>
                  {separator}
                  <Text color={theme.accent}>
                    in {String(tokenBreakdown.input)} · out{" "}
                    {String(tokenBreakdown.output)}
                  </Text>
                </>
              )}
              {separator}
              <Text color={theme.warning}>
                ${tokenBreakdown.cost.toFixed(4)}
              </Text>
              {!isUltraNarrow && (
                <Text color={theme.dim}>
                  in ${tokenBreakdown.inputCost.toFixed(4)} / out $
                  {tokenBreakdown.outputCost.toFixed(4)}
                </Text>
              )}
            </Box>
          ) : (
            <Box gap={1}>
              <Text color={theme.success} bold>
                {tokenBreakdown.total}T
              </Text>
              <Text color={theme.warning}>
                ${tokenBreakdown.cost.toFixed(4)}
              </Text>
              {separator}
              {!isNarrow && <Text color={theme.dim}>ctx</Text>}
              {!isUltraNarrow &&
                (contextSegments ? (
                  <Text>
                    <Text color={getContextColor(usedPercent)}>
                      {"█".repeat(
                        Math.max(1, Math.round(contextSegments.usedPct / 10)),
                      )}
                    </Text>
                    <Text color={theme.divider}>
                      {"▒".repeat(
                        Math.max(
                          0,
                          Math.round(contextSegments.reservedPct / 10),
                        ),
                      )}
                    </Text>
                  </Text>
                ) : (
                  <Sparkline
                    data={contextHistory}
                    color={getContextColor(usedPercent)}
                  />
                ))}
              <Text color={getContextColor(usedPercent)}>
                {Math.round(usedPercent)}%
              </Text>
              {!isNarrow && contextSegments && (
                <Text color={theme.dim}>
                  · out ~{Math.round(contextSegments.reservedPct)}%
                </Text>
              )}
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
