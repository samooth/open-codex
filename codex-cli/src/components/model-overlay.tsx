import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { useAppContext } from "../contexts/app-context.js";
import { Box, Text, useInput } from "ink";
import React from "react";

// Mapping models to their recommended uses
const modelDescriptions: Record<string, string> = {
  "o4-mini": "OpenAI - Fast, efficient, and great for common tasks.",
  "o3": "OpenAI - High reasoning, best for complex logic and deep thinking.",
  "claude-opus-4-6": "Anthropic - Balanced power and speed with high accuracy.",
  "gemini-2.5-flash": "Google - Ultra-fast with a massive context window.",
  "deepseek-chat":
    "DeepSeek - Versatile and optimized for developer efficiency.",
};

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

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const providerModels = (config as any).providers?.[
    config.provider || "openai"
  ]?.models || ["o4-mini", "o3"];

  const options = (providerModels as Array<string>).map((m: string) => ({
    label: `${m === currentModel ? "❯ " : "  "}${m.toUpperCase()}`,
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
          </Box>

          <Box flexDirection="column" paddingX={1} marginBottom={1}>
            <SelectInput
              items={options}
              onSelect={handleSelect}
              theme={theme}
              isFocused={true}
            />
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
              ↑↓ navigate │ enter switch │ esc close
            </Text>
          </Box>
        </>
      )}
    </Box>
  );
}
