import { SemanticDiffLine, SemanticDiffPair } from "./semantic-diff.js";
import { TerminalHyperlink, getFileUrl } from "./terminal-hyperlink.js";
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
  isActive = false,
}: {
  commandForDisplay: string;
  applyPatch?: ApplyPatchCommand;
  theme: Theme;
  isActive?: boolean;
}): React.ReactElement {
  const { rows, columns } = useTerminalSize();
  const isPatch =
    !!applyPatch ||
    commandForDisplay.includes("apply_patch") ||
    commandForDisplay.startsWith("*** Begin Patch");

  const [selectedOpIndex, setSelectedOpIndex] = useState(0);
  const [collapsedOps, setCollapsedOps] = useState<Set<number>>(new Set());
  const [isExpandedAll, setIsExpandedAll] = useState(false);
  
  // path -> hunkIndices
  const [excludedHunks, setExcludedHunks] = useState<Record<string, number[]>>(
    applyPatch?.excludedHunks || {}
  );

  const ops = React.useMemo(() => {
    if (applyPatch) return parseApplyPatch(applyPatch.patch);
    if (commandForDisplay.includes("*** Begin Patch")) {
      const match = commandForDisplay.match(/\*\*\* Begin Patch[\s\S]*\*\*\* End Patch/);
      if (match) return parseApplyPatch(match[0]);
    }
    return null;
  }, [applyPatch, commandForDisplay]);

  useInput((input, key) => {
    if (!isActive) return;

    if (input === "e") {
      setIsExpandedAll(!isExpandedAll);
      return;
    }
    
    if (isPatch && ops && ops.length > 0) {
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
      } else if (input === " ") {
        const op = ops[selectedOpIndex];
        if (op && (op.type === "update" || op.type === "create")) {
          const path = op.path;
          // For now, toggle the WHOLE file if it's not expanded to hunks,
          // OR if we want to implement hunk-level toggling we need another cursor.
          // Let's implement hunk toggling if the file has hunks.
          // Actually, let's keep it simple: Space toggles the CURRENT selected file.
          // If we want HUNKS, we need a 2D cursor.
          // For MVP: Toggle all hunks of this file.
          setExcludedHunks(prev => {
            const next = { ...prev };
            const currentExcl = next[path] || [];
            if (currentExcl.length > 0) {
              delete next[path];
            } else {
              next[path] = op.hunks.map((_, idx) => idx);
            }
            
            // Sync back to the parent state if possible
            if (applyPatch) {
              applyPatch.excludedHunks = next;
            }
            
            return next;
          });
        }
      }
    }
  }, { isActive });

  if (isPatch && ops) {
    // Strictly limit patch preview height to keep confirmation prompt on screen unless expanded
    const maxTotalLines = isExpandedAll ? 1000 : 8;
    let totalLinesRendered = 0;
    const isEditFile = commandForDisplay.startsWith("edit_file");

    return (
      <Box flexDirection="column" gap={0} width="100%" marginY={1}>
        <Box 
          flexDirection="column" 
          paddingLeft={1} 
          borderStyle="bold" 
          borderRight={false} 
          borderTop={false} 
          borderBottom={false} 
          borderLeftColor={theme.accent}
        >
          <Box gap={1} marginBottom={1}>
            <Text bold color={theme.accent} inverse paddingX={1}>
              {isEditFile ? " EDIT FILE " : " APPLY PATCH "}
            </Text>
            <Text dimColor italic size={0.8}> (↑↓ navigate │ space toggle │ 'e' {isExpandedAll ? 'collapse' : 'expand'})</Text>
          </Box>
          
          {ops.length > 1 && (
            <Box marginBottom={1}>
              <Text dimColor italic size={0.8}> [ ↑↓ navigate │ 'c' toggle file ]</Text>
            </Box>
          )}

          {ops.map((op, i) => {
            if (totalLinesRendered >= maxTotalLines && !collapsedOps.has(i) && i !== selectedOpIndex) return null;

            const isSelected = i === selectedOpIndex;
            const isCollapsed = collapsedOps.has(i) && !isSelected;
            const isExcluded = (op.type === "update" || op.type === "create") && 
                               excludedHunks[op.path] && excludedHunks[op.path]!.length === op.hunks.length;

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
              <Box 
                key={i} 
                flexDirection="column" 
                marginTop={0} 
                marginBottom={1}
                paddingLeft={1} 
                borderStyle="bold" 
                borderRight={false} 
                borderTop={false} 
                borderBottom={false} 
                borderLeftColor={isSelected ? theme.highlight : theme.divider}
              >
                <Box gap={1}>
                  <Text 
                    bold 
                    color={isExcluded ? theme.dim : (op.type === "delete" ? theme.error : theme.highlight)}
                    strikethrough={isExcluded}
                  >
                    {isSelected ? "❯ " : "  "}{op.type.toUpperCase()}
                  </Text>
                  <TerminalHyperlink url={getFileUrl(op.path)}>
                    <Text 
                      bold 
                      wrap="wrap" 
                      color={isSelected ? theme.accent : undefined}
                      strikethrough={isExcluded}
                    >
                      {shortenPath(op.path)}
                    </Text>
                  </TerminalHyperlink>
                  <Text color={theme.dim}>
                    (+{op.added} -{op.deleted})
                  </Text>
                  {isExcluded && <Text color={theme.error} bold> [EXCLUDED]</Text>}
                  {isCollapsed && <Text italic color={theme.dim}> [collapsed]</Text>}
                </Box>
                {!isCollapsed && !isExcluded && (
                  <Box marginTop={0} flexDirection="column" paddingLeft={2}>
                    {op.type === "delete" && (
                      <Text color={theme.error} italic>File will be deleted</Text>
                    )}
                    {(() => {
                      const renderedLines: React.ReactNode[] = [];
                      for (let j = 0; j < linesToDisplay.length; j++) {
                        const line = linesToDisplay[j]!;
                        const nextLine = linesToDisplay[j + 1];
                        
                        // Semantic pair detection: current is '-' and next is '+'
                        if (line.startsWith("-") && nextLine?.startsWith("+") && op.type === "update") {
                          renderedLines.push(
                            <SemanticDiffPair 
                              key={j} 
                              removed={line} 
                              added={nextLine} 
                              theme={theme} 
                            />
                          );
                          j++; // Skip the next line
                        } else {
                          renderedLines.push(
                            <SemanticDiffLine 
                              key={j} 
                              line={line} 
                              theme={theme} 
                            />
                          );
                        }
                      }
                      return renderedLines;
                    })()}
                    {showTruncated && (
                      <Text color={theme.dim} italic>... ({lines.length - availableLines} more lines)</Text>
                    )}
                  </Box>
                )}
              </Box>
            );
          })}
          {ops.length > 0 && totalLinesRendered >= maxTotalLines && (
             <Box paddingLeft={1} marginTop={0}>
               <Text color={theme.dim} italic>+ {ops.length - ops.filter((_, idx) => idx < totalLinesRendered).length} more files truncated</Text>
             </Box>
          )}
        </Box>
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
        return chalk.greenBright(line);
      }
      if (line.startsWith("-") && !line.startsWith("--")) {
        return chalk.redBright(line);
      }
      return line;
    })
    .join("\n");

  return (
    <Box
      flexDirection="column"
      gap={0}
      width="100%"
      marginY={1}
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.warning}
    >
      <Box gap={1} marginBottom={1}>
        <Text bold color={theme.warning} inverse paddingX={1}>
          SHELL COMMAND
        </Text>
        <Text dimColor italic size={0.8}> (press 'e' to {isExpandedAll ? 'collapse' : 'expand'})</Text>
      </Box>
      <Box paddingLeft={2} flexDirection="column">
        <Text wrap="wrap">
          <Text color={theme.dim} bold>$</Text> <Text color={theme.shellCommand}>{colorizedCommand}</Text>
        </Text>
        {showTruncatedCmd && (
          <Text color={theme.dim} italic>... ({commandLines.length - maxTotalLines} more lines)</Text>
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
