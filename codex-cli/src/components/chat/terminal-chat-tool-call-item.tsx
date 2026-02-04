import { parseApplyPatch } from "../../parse-apply-patch";
import { shortenPath } from "../../utils/short-path";
import chalk from "chalk";
import { Box, Text } from "ink";
import React from "react";

export function TerminalChatToolCallCommand({
  commandForDisplay,
  applyPatch,
}: {
  commandForDisplay: string;
  applyPatch?: { patch: string };
}): React.ReactElement {
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
    return (
      <Box flexDirection="column" gap={0}>
        <Text bold color="magentaBright">
          🩹 Apply Patch
        </Text>
        {ops.map((op, i) => (
          <Box key={i} flexDirection="column" marginTop={1} paddingLeft={2} borderStyle="round" borderColor="gray">
            <Box gap={1}>
              <Text bold color={op.type === "delete" ? "red" : "cyan"}>
                {op.type === "create" ? "CREATE" : op.type === "delete" ? "DELETE" : "UPDATE"}
              </Text>
              <Text bold>{shortenPath(op.path)}</Text>
              {op.type === "update" && (
                <Text dimColor>
                  ({op.added} added, {op.deleted} deleted)
                </Text>
              )}
            </Box>
            <Box marginTop={1} flexDirection="column">
              {op.type === "delete" && (
                <Text color="red" italic>File will be deleted</Text>
              )}
              {(op.type === "create" ? op.content : op.type === "update" ? op.update : "")
                .split("\n")
                .map((line, j) => {
                  if (!line && op.type === "update") return null; // skip trailing newline from split if update is empty
                  const displayLine = op.type === "create" ? `+${line}` : line;
                  if (displayLine.startsWith("+") && !displayLine.startsWith("++")) {
                    return <Text key={j} color="green">{displayLine}</Text>;
                  }
                  if (displayLine.startsWith("-") && !displayLine.startsWith("--")) {
                    return <Text key={j} color="red">{displayLine}</Text>;
                  }
                  if (displayLine.startsWith("@@")) {
                    return <Text key={j} color="cyan" dimColor>{displayLine}</Text>;
                  }
                  return <Text key={j}>{displayLine}</Text>;
                })}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  const colorizedCommand = commandForDisplay
    .split("\n")
    .map((line) => {
      if (line.startsWith("+") && !line.startsWith("++")) {
        return chalk.green(line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk.red(line);
      }
      return line;
    })
    .join("\n");

  return (
    <Box flexDirection="column" gap={0}>
      <Text bold color="yellow">
        🐚 Shell Command
      </Text>
      <Box paddingLeft={2} marginTop={1}>
        <Text>
          <Text dimColor>$</Text> {colorizedCommand}
        </Text>
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
