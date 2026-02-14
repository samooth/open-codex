import { parseApplyPatch } from "../../parse-apply-patch";
import { shortenPath } from "../../utils/short-path";
import { useTerminalSize } from "../../hooks/use-terminal-size";
import type { Theme } from "../../utils/theme";
import chalk from "chalk";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

export function TerminalChatToolCallCommand({
  commandForDisplay,
  applyPatch,
  theme,
}: {
  commandForDisplay: string;
  applyPatch?: { patch: string };
  theme: Theme;
}): React.ReactElement {
  const { rows, columns } = useTerminalSize();
  const isPatch =
    !!applyPatch ||
    commandForDisplay.includes("apply_patch") ||
    commandForDisplay.startsWith("*** Begin Patch");

  const [selectedOpIndex, setSelectedOpIndex] = useState(0);
  const [collapsedOps, setCollapsedOps] = useState<Set<number>>(new Set());
  const [isExpandedAll, setIsExpandedAll] = useState(false);

  useInput((input, key) => {
    if (input === "e") {
      setIsExpandedAll(!isExpandedAll);
      return;
    }
    if (isPatch && ops && ops.length > 1) {
      if (key.upArrow) {
        setSelectedOpIndex(prev => (prev - 1 + ops.length) % ops.length);
      } else if (key.downArrow) {
        setSelectedOpIndex(prev => (prev + 1) % ops.length);
      } else if (input === "c") {
        setCollapsedOps(prev => {
          const next = new Set(prev);
          if (next.has(selectedOpIndex)) {
            next.delete(selectedOpIndex);
          } else {
            next.add(selectedOpIndex);
          }
          return next;
        });
      }
    }
  });

  const ops = React.useMemo(() => {
    if (applyPatch) return parseApplyPatch(applyPatch.patch);
    if (commandForDisplay.includes("*** Begin Patch")) {
      const match = commandForDisplay.match(/\*\*\* Begin Patch[\s\S]*\*\*\* End Patch/);
      if (match) return parseApplyPatch(match[0]);
    }
    return null;
  }, [applyPatch, commandForDisplay]);

  if (isPatch && ops) {
    // Strictly limit patch preview height to keep confirmation prompt on screen unless expanded
    const maxTotalLines = isExpandedAll ? 1000 : 8;
    let totalLinesRendered = 0;
    const isEditFile = commandForDisplay.startsWith("edit_file");

    return (
      <Box flexDirection="column" gap={0} width="100%">
        <Box gap={1} paddingX={1}>
          <Text bold color={theme.toolLabel} wrap="wrap">
            {isEditFile ? "📝 Edit File" : "🩹 Apply Patch"}
          </Text>
          <Text dimColor italic> (press 'e' to {isExpandedAll ? 'collapse' : 'expand all'})</Text>
        </Box>
        {ops.length > 1 && (
          <Box paddingX={1}>
            <Text dimColor italic> (↑↓ to navigate files, 'c' to toggle visibility)</Text>
          </Box>
        )}
        {ops.map((op, i) => {
          if (totalLinesRendered >= maxTotalLines && !collapsedOps.has(i) && i !== selectedOpIndex) return null;

          const isSelected = i === selectedOpIndex;
          const isCollapsed = collapsedOps.has(i) && !isSelected;

          const lines = (op.type === "create" ? op.content : op.type === "update" ? op.update : "")
            .split("\n")
            .filter(l => l.trim().length > 0 || op.type === "create");
          
          const availableLines = isCollapsed ? 0 : Math.max(1, maxTotalLines - totalLinesRendered - 2); 
          const showTruncated = !isCollapsed && lines.length > availableLines;
          const linesToDisplay = isCollapsed ? [] : (showTruncated ? lines.slice(0, availableLines) : lines);
          
          if (!isCollapsed) {
            totalLinesRendered += linesToDisplay.length + 2;
          } else {
            totalLinesRendered += 1;
          }

          return (
            <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2} borderStyle={isSelected ? "double" : "round"} borderColor={isSelected ? theme.highlight : theme.dim}>
              <Box gap={1}>
                <Text bold color={op.type === "delete" ? theme.error : theme.highlight}>
                  {op.type === "create" ? "CREATE" : op.type === "delete" ? "DELETE" : "UPDATE"}
                </Text>
                <Text bold wrap="wrap">{shortenPath(op.path)}</Text>
                <Text color={theme.dim}>
                  ({op.added} added, {op.deleted} deleted)
                </Text>
                {isCollapsed && <Text italic color={theme.dim}> (collapsed, press 'c' to expand)</Text>}
              </Box>
              {!isCollapsed && (
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
              )}
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

  const maxTotalLines = isExpandedAll ? 1000 : 5;
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
    <Box
      flexDirection="column"
      gap={0}
      borderStyle="round"
      borderColor={theme.highlight}
      width="100%"
      marginY={1}
    >
      <Box gap={1} paddingX={1}>
        <Text bold color={theme.warning} wrap="wrap">
          🐚 Shell Command
        </Text>
        <Text dimColor italic> (press 'e' to {isExpandedAll ? 'collapse' : 'expand all'})</Text>
      </Box>
      <Box paddingLeft={3} paddingRight={1} marginTop={1} flexDirection="column">
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
