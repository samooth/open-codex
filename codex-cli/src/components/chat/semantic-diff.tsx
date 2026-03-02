import type { Theme } from "../../utils/theme";

import * as diff from "diff";
import { Text, Box } from "ink";
import React, { useMemo } from "react";
import { highlight as syntaxHighlight } from "cli-highlight";
import { getSyntaxTheme } from "../../utils/theme";

/**
 * Renders a single diff line with character-level highlighting.
 * If consecutive lines are - and +, it can perform semantic highlighting.
 */
export function SemanticDiffLine({
  line,
  theme,
  language,
}: {
  line: string;
  theme: Theme;
  language?: string;
}) {
  const highlightedLine = useMemo(() => {
    if (!language) {
      return line;
    }
    try {
      return syntaxHighlight(line, {
        language,
        ignoreIllegals: true,
        theme: getSyntaxTheme(theme),
        // Remove leading/trailing newlines added by cli-highlight which break Ink rendering
        // @ts-expect-error - 'trim' does not exist in type 'HighlightOptions'
        trim: true,
      });
    } catch (e) {
      return line; // Fallback to raw line on error
    }
  }, [line, language, theme]);

  if (line.startsWith("+") && !line.startsWith("++")) {
    return <Text color="greenBright">{highlightedLine}</Text>;
  }
  if (line.startsWith("-") && !line.startsWith("--")) {
    return <Text color="redBright">{highlightedLine}</Text>;
  }
  if (line.startsWith("@@")) {
    return (
      <Text color={theme.highlight} dimColor>
        {line}
      </Text>
    );
  }
  return <Text color={theme.dim}>{highlightedLine}</Text>;
}

/**
 * Renders a pair of lines (one removed, one added) with semantic highlights.
 */
export function SemanticDiffPair({
  removed,
  added,
  theme,
  language,
}: {
  removed: string;
  added: string;
  theme: Theme;
  language?: string;
}) {
  // Remove the prefix (+/-) for comparison
  const removedContent = removed.slice(1);
  const addedContent = added.slice(1);

  const diffResult = useMemo(
    () => (diff as any).diffChars(removedContent, addedContent),
    [removedContent, addedContent],
  );

  const syntaxTheme = useMemo(() => getSyntaxTheme(theme), [theme]);

  const highlightCode = (code: string) => {
    if (!language) {
      return code;
    }
    try {
      return syntaxHighlight(code, {
        language,
        ignoreIllegals: true,
        theme: syntaxTheme,
        // @ts-expect-error - 'trim' does not exist in type 'HighlightOptions'
        trim: true,
      });
    } catch {
      return code;
    }
  };

  // Apply syntax highlighting to the full lines first
  const highlightedRemovedContent = useMemo(
    () => highlightCode(removedContent),
    [removedContent, language, syntaxTheme],
  );
  const highlightedAddedContent = useMemo(
    () => highlightCode(addedContent),
    [addedContent, language, syntaxTheme],
  );

  // Now apply character-level diff highlighting on top of syntax highlighting
  // This is a simplified approach, a more robust solution would involve parsing
  // the highlighted text and then applying diffs.
  const applyCharDiff = (fullLine: string, isRemovedLine: boolean) => {
    const parts: React.ReactNode[] = [];
    let currentIndex = 0;

    diffResult.forEach((part: any) => {
      const value = part.value;
      const start = fullLine.indexOf(value, currentIndex);

      if (start !== -1) {
        // Add non-diffed part before the current diff segment
        if (start > currentIndex) {
          parts.push(
            <Text key={`plain-${currentIndex}`}>
              {fullLine.substring(currentIndex, start)}
            </Text>,
          );
        }

        const color = isRemovedLine ? "redBright" : "greenBright";
        const backgroundColor = isRemovedLine ? "red" : "green";
        const shouldHighlight = isRemovedLine ? part.removed : part.added;

        parts.push(
          <Text
            key={`${start}-${currentIndex}`}
            color={color}
            backgroundColor={shouldHighlight ? backgroundColor : undefined}
            bold={shouldHighlight}
          >
            {value}
          </Text>,
        );
        currentIndex = start + value.length;
      }
    });

    // Add any remaining part of the line after the last diff segment
    if (currentIndex < fullLine.length) {
      parts.push(
        <Text key={`final-${currentIndex}`}>
          {fullLine.substring(currentIndex)}
        </Text>,
      );
    }

    return parts;
  };

  return (
    <Box flexDirection="column">
      {/* Removed line with highlights for deletions */}
      <Box>
        <Text color="redBright">-</Text>
        {applyCharDiff(highlightedRemovedContent, true)}
      </Box>
      {/* Added line with highlights for additions */}
      <Box>
        <Text color="greenBright">+</Text>
        {applyCharDiff(highlightedAddedContent, false)}
      </Box>
    </Box>
  );
}
