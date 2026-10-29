import type { Theme } from "../../utils/theme.js";

import { loadRollouts } from "../../utils/storage/save-rollout.js";
import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

type RecentSession = {
  id: string;
  summary: string;
  timestamp: string;
};

function formatRelativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return "";
  }
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return `${Math.floor(days / 30)}mo`;
}

export const STARTERS = [
  "explain this codebase to me",
  "fix any build errors",
  "are there any bugs in my code?",
];

/**
 * Compact empty-state view: purely presentational. No useInput, so typing
 * in the main prompt can never be hijacked. The parent owns selection state
 * and calls onRestore/onSuggestion directly.
 */
export default function WelcomeView({
  theme,
  selected,
  gitInfo,
}: {
  theme: Theme;
  selected: number;
  gitInfo?: { branch: string; dirty: boolean; lastCommit: string };
}): React.ReactElement | null {
  const [recent, setRecent] = useState<Array<RecentSession>>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadRollouts().then((rollouts) => {
      if (cancelled) return;
      setRecent(
        rollouts.slice(0, 3).map((r) => ({
          id: r.session.id ?? "",
          summary: r.session.summary ?? "",
          timestamp: r.session.timestamp ?? "",
        })),
      );
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) {
    return null;
  }

  const hasSelection = selected >= 0;

  return (
    <Box flexDirection="column" paddingX={2}>
      {gitInfo && (
        <Box gap={1} marginBottom={0}>
          <Text color={theme.dim}>repo</Text>
          <Text color={theme.highlight}>{gitInfo.branch}</Text>
          {gitInfo.dirty && (
            <Text color={theme.warning}> · dirty</Text>
          )}
          {gitInfo.lastCommit && (
            <Text color={theme.dim}>
              {" "}· {gitInfo.lastCommit.slice(0, 60)}
            </Text>
          )}
        </Box>
      )}
      {recent.length > 0 && (
        <Box gap={1}>
          <Text color={theme.dim}>resume</Text>
          {recent.map((s, i) => (
            <Text
              key={s.id || i}
              color={i === selected ? theme.highlight : theme.dim}
              bold={i === selected}
            >
              {(s.summary || "untitled").slice(0, 24)}
              <Text color={theme.divider}> {formatRelativeDate(s.timestamp)}</Text>
              {i < recent.length - 1 ? " ·" : ""}
            </Text>
          ))}
          <Text color={theme.dim}>h all</Text>
        </Box>
      )}
      <Box gap={1}>
        <Text color={theme.dim}>try</Text>
        {STARTERS.map((s, i) => {
          const idx = recent.length + i;
          return (
            <Text
              key={s}
              color={idx === selected ? theme.highlight : theme.dim}
            >
              {s}
              {i < STARTERS.length - 1 ? " ·" : ""}
            </Text>
          );
        })}
      </Box>
      {hasSelection && (
        <Box>
          <Text color={theme.dim}>
            tab cycle · enter {selected < recent.length ? "restore" : "run"}
          </Text>
        </Box>
      )}
      <Box marginTop={0}>
        <Text color={theme.dim}>
          ctrl+p palette · ctrl+r history · /help · /theme
        </Text>
      </Box>
    </Box>
  );
}
