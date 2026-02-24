import React, { useMemo } from "react";
import { Text, Box } from "ink";
import * as diff from "diff";
import type { Theme } from "../../utils/theme";

/**
 * Renders a single diff line with character-level highlighting.
 * If consecutive lines are - and +, it can perform semantic highlighting.
 */
export function SemanticDiffLine({
  line,
  theme,
}: {
  line: string;
  theme: Theme;
}) {
  if (line.startsWith("+") && !line.startsWith("++")) {
    return <Text color="greenBright">{line}</Text>;
  }
  if (line.startsWith("-") && !line.startsWith("--")) {
    return <Text color="redBright">{line}</Text>;
  }
  if (line.startsWith("@@")) {
    return <Text color={theme.highlight} dimColor>{line}</Text>;
  }
  return <Text color={theme.dim}>{line}</Text>;
}

/**
 * Renders a pair of lines (one removed, one added) with semantic highlights.
 */
export function SemanticDiffPair({
  removed,
  added,
}: {
  removed: string;
  added: string;
  theme: Theme;
}) {
  // Remove the prefix (+/-) for comparison
  const removedContent = removed.slice(1);
  const addedContent = added.slice(1);

  const diffResult = useMemo(() => (diff as any).diffChars(removedContent, addedContent), [removedContent, addedContent]);

  return (
    <Box flexDirection="column">
      {/* Removed line with highlights for deletions */}
      <Box>
        <Text color="redBright">-</Text>
        {diffResult.map((part: any, i: number) => {
          if (part.added) return null;
          return (
            <Text
              key={i}
              color="redBright"
              backgroundColor={part.removed ? "red" : undefined}
              bold={part.removed}
            >
              {part.value}
            </Text>
          );
        })}
      </Box>
      {/* Added line with highlights for additions */}
      <Box>
        <Text color="greenBright">+</Text>
        {diffResult.map((part: any, i: number) => {
          if (part.removed) return null;
          return (
            <Text
              key={i}
              color="greenBright"
              backgroundColor={part.added ? "green" : undefined}
              bold={part.added}
            >
              {part.value}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
