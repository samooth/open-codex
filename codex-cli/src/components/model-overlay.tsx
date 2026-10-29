import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { useAppContext } from "../contexts/app-context.js";
import { getAvailableModels } from "../utils/model-utils.js";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";

// Mapping models to their recommended uses
const modelDescriptions: Record<string, string> = {
  "gpt-5.2": "OpenAI - Next-generation reasoning and massive context support.",
  "o4-mini": "OpenAI - Fast, efficient, and great for common tasks.",
  "o3": "OpenAI - High reasoning, best for complex logic and deep thinking.",
  "claude-opus-4-6": "Anthropic - Balanced power and speed with high accuracy.",
  "gemini-2.5-flash": "Google - Ultra-fast with a massive context window.",
  "deepseek-chat":
    "DeepSeek - Versatile and optimized for developer efficiency.",
};

const PAGE_SIZE = 12;

export default function ModelOverlay({
  currentModel,
  hasLastResponse,
  onSelect,
  onExit,
  theme,
}: {
  currentModel: string;
  hasLastResponse: boolean;
  onSelect: (model: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const { config } = useAppContext();
  const [models, setModels] = useState<Array<string>>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useInput((input, key) => {
    if (key.escape) {
      onExit();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
      return;
    }
    // Typing a printable character updates the search filter.
    if (input && input.length === 1 && !key.ctrl && !key.meta && !key.return) {
      const code = input.charCodeAt(0);
      if (code >= 32 && code < 127) {
        setQuery((q) => q + input);
      }
    }
  });

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAvailableModels(config)
      .then((list) => {
        if (cancelled) return;
        if (list && list.length > 0) {
          setModels(list);
        } else {
          const configured = (config as any).providers?.[
            config.provider || "openai"
          ]?.models;
          setModels(
            Array.isArray(configured) && configured.length > 0
              ? configured
              : ["gpt-5.2", "o4-mini", "o3"],
          );
        }
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        const configured = (config as any).providers?.[
          config.provider || "openai"
        ]?.models;
        setModels(
          Array.isArray(configured) && configured.length > 0
            ? configured
            : ["gpt-5.2", "o4-mini", "o3"],
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config]);

  const filtered = query
    ? models.filter((m) => m.toLowerCase().includes(query.toLowerCase()))
    : models;

  const options = filtered.map((m: string) => ({
    label: `${m === currentModel ? "❯ " : "  "}${m}`,
    value: m,
    description: modelDescriptions[m] || `${config.provider} model`,
  }));

  const handleSelect = (item: any) => {
    onSelect(item.value);
  };

  return (
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={80}
      marginY={1}
    >
      {hasLastResponse ? (
        <Box gap={1} marginBottom={1}>
          <Box backgroundColor={theme.error as any} paddingX={1}>
            <Text bold color="black">
              {" "}
              LOCKED{" "}
            </Text>
          </Box>
          <Text color={theme.error} bold>
            FINISH CURRENT TURN TO SWITCH
          </Text>
        </Box>
      ) : (
        <>
          <Box gap={1} marginBottom={1}>
            <Box backgroundColor={theme.highlight as any} paddingX={1}>
              <Text bold color="black">
                {" "}
                MODELS{" "}
              </Text>
            </Box>
            <Text color={theme.highlight} bold>
              SWITCH AI ENGINE
            </Text>
            <Text color={theme.dim}>
              ({filtered.length}/{models.length})
            </Text>
          </Box>

          <Box paddingLeft={1} marginBottom={1}>
            <Text color={theme.dim}>search: </Text>
            <Text color={theme.highlight}>{query || " "}</Text>
            <Text color={theme.dim}> (type to filter, backspace to edit)</Text>
          </Box>

          <Box flexDirection="column" paddingX={1} marginBottom={1}>
            {loading ? (
              <Text color={theme.dim}>loading models…</Text>
            ) : options.length === 0 ? (
              <Text color={theme.dim}>no models match</Text>
            ) : (
              <SelectInput
                items={options}
                onSelect={handleSelect}
                theme={theme}
                isFocused={true}
                itemsPerPage={PAGE_SIZE}
              />
            )}
          </Box>

          <Box
            borderStyle="single"
            borderRight={false}
            borderTop={true}
            borderBottom={false}
            borderLeft={false}
            borderTopColor={theme.divider}
            paddingX={1}
            paddingTop={1}
          >
            <Text dimColor italic>
              type to search │ ↑↓ navigate │ ←→ page │ enter switch │ esc close
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
