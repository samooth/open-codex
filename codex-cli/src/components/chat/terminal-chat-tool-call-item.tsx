import { parseApplyPatch } from "../../parse-apply-patch";
import { shortenPath } from "../../utils/short-path";
import { useTerminalSize } from "../../hooks/use-terminal-size";
import type { Theme } from "../../utils/theme";
import chalk from "chalk";
import { Box, Text } from "ink";
import React from "react";

export function TerminalChatToolCallCommand({
  commandForDisplay,
  applyPatch,
  terminalRows = 40,
  theme,
}: {
  commandForDisplay: string;
  applyPatch?: { patch: string };
  terminalRows?: number;
  theme: Theme;
}): React.ReactElement {
  const size = useTerminalSize();
  const isPatch =
    !!applyPatch ||
    commandForDisplay.includes("apply_patch") ||
    commandForDisplay.startsWith("*** Begin Patch");

  const ops = React.useMemo(() => {
    if (applyPatch) return parseApplyPatch(applyPatch.patch);
    if (commandForDisplay.includes("*** Begin Patch")) {
      const match = commandForDisplay.match(/\*\*\* Begin Patch[\s\S]*\*\*\* End Patch/);
      if (match) return parseApplyPatch(match[0]);
    }
    return null;
  }, [applyPatch, commandForDisplay]);

  if (isPatch && ops) {
    // Calculate a reasonable max lines for the entire patch preview
    // We want to leave some space for the confirmation options and header.
    const maxTotalLines = Math.max(10, terminalRows - 15);
    let totalLinesRendered = 0;

    return (
      <Box flexDirection="column" gap={0} width={size.columns - 4}>
        <Text bold color={theme.toolLabel} wrap="wrap">
          🩹 Apply Patch
        </Text>
        {ops.map((op, i) => {
          if (totalLinesRendered >= maxTotalLines) return null;

          const lines = (op.type === "create" ? op.content : op.type === "update" ? op.update : "")
            .split("\n");
          
          const availableLines = maxTotalLines - totalLinesRendered - 3; // -3 for headers/padding
          const showTruncated = lines.length > availableLines && availableLines > 0;
          const linesToDisplay = showTruncated ? lines.slice(0, availableLines) : lines;
          
          totalLinesRendered += linesToDisplay.length + 3;

          return (
            <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2} borderStyle="round" borderColor={theme.dim}>
              <Box gap={1}>
                <Text bold color={op.type === "delete" ? theme.error : theme.highlight}>
                  {op.type === "create" ? "CREATE" : op.type === "delete" ? "DELETE" : "UPDATE"}
                </Text>
                <Text bold wrap="wrap">{shortenPath(op.path)}</Text>
                {op.type === "update" && (
                  <Text color={theme.dim}>
                    ({op.added} added, {op.deleted} deleted)
                  </Text>
                )}
              </Box>
              <Box marginTop={1} flexDirection="column">
                {op.type === "delete" && (
                  <Text color={theme.error} italic>File will be deleted</Text>
                )}
                {linesToDisplay
                  .map((line, j) => {
                    if (!line && op.type === "update") return null; 
                    const displayLine = op.type === "create" ? `+${line}` : line;
                    if (displayLine.startsWith("+") && !displayLine.startsWith("++")) {
                      return <Text key={j} color={theme.success} wrap="wrap">{displayLine}</Text>;
                    }
                    if (displayLine.startsWith("-") && !displayLine.startsWith("--")) {
                      return <Text key={j} color={theme.error} wrap="wrap">{displayLine}</Text>;
                    }
                    if (displayLine.startsWith("@@")) {
                      return <Text key={j} color={theme.highlight} dimColor wrap="wrap">{displayLine}</Text>;
                    }
                    return <Text key={j} wrap="wrap" color={theme.dim}>{displayLine}</Text>;
                  })}
                {showTruncated && (
                  <Text color={theme.dim} italic>... ({lines.length - availableLines} more lines truncated)</Text>
                )}
              </Box>
            </Box>
          );
        })}
        {ops.length > 0 && totalLinesRendered >= maxTotalLines && (
           <Box paddingLeft={2} marginTop={1}>
             <Text color={theme.dim} italic>+ {ops.length - ops.filter((_, idx) => idx < totalLinesRendered).length} more files truncated</Text>
           </Box>
        )}
      </Box>
    );
  }

  const maxTotalLines = Math.max(10, terminalRows - 15);
  const commandLines = commandForDisplay.split("\n");
  const showTruncatedCmd = commandLines.length > maxTotalLines;
  const commandToDisplay = showTruncatedCmd ? commandLines.slice(0, maxTotalLines).join("\n") : commandForDisplay;

  const colorizedCommand = commandToDisplay
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("++")) {
        return chalk[theme.success](line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk[theme.error](line);
      }
      return line;
    })
    .join("\n");

  return (
    <Box flexDirection="column" gap={0} width={size.columns - 4}>
      <Text bold color={theme.warning} wrap="wrap">
        🐚 Shell Command
      </Text>
      <Box paddingLeft={2} marginTop={1} flexDirection="column">
        <Text wrap="wrap">
          <Text color={theme.dim}>$</Text> {colorizedCommand}
        </Text>
        {showTruncatedCmd && (
          <Text color={theme.dim} italic>... ({commandLines.length - maxTotalLines} more lines truncated)</Text>
        )}
      </Box>
    </Box>
  );
}

export function TerminalChatToolCallApplyPatch({
  commandForDisplay,
  patch,
}: {
  commandForDisplay: string;
  patch: string;
}): React.ReactElement {
  const ops = React.useMemo(() => parseApplyPatch(patch), [patch]);
  const firstOp = ops?.[0];

  const title = React.useMemo(() => {
    if (!firstOp) {
      return "";
    }
    return capitalize(firstOp.type);
  }, [firstOp]);

  const filePath = React.useMemo(() => {
    if (!firstOp) {
      return "";
    }
    return shortenPath(firstOp.path || ".");
  }, [firstOp]);

  if (ops == null) {
    return (
      <>
        <Text bold color="red">
          Invalid Patch
        </Text>
        <Text color="red" dimColor>
          The provided patch command is invalid.
        </Text>
        <Text dimColor>{commandForDisplay}</Text>
      </>
    );
  }

  if (!firstOp) {
    return (
      <>
        <Text bold color="yellow">
          Empty Patch
        </Text>
        <Text color="yellow" dimColor>
          No operations found in the patch command.
        </Text>
        <Text dimColor>{commandForDisplay}</Text>
      </>
    );
  }

  return (
    <>
      <Text>
        <Text bold>{title}</Text> <Text dimColor>{filePath}</Text>
      </Text>
      <Text>
        <Text dimColor>$</Text> {commandForDisplay}
      </Text>
    </>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
