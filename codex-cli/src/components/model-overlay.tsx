import type { AppConfig } from "../utils/config.js";

import TypeaheadOverlay from "./typeahead-overlay.js";
import {
  getAvailableModels,
  RECOMMENDED_MODELS,
} from "../utils/model-utils.js";
import { log, isLoggingEnabled } from "../utils/agent/log.js";
import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
import type { Theme } from "../utils/theme.js";

/**
 * Props for <ModelOverlay>.
 *
 * When `hasLastResponse` is true the user has already received at least one
 * assistant response in the current session which means switching models is no
 * longer supported – the overlay should therefore show an error and only allow
 * the user to close it.
 */
type Props = {
  currentModel: string;
  config: AppConfig;
  hasLastResponse: boolean;
  onSelect: (model: string) => void;
  onExit: () => void;
  theme: Theme;
};

export default function ModelOverlay({
  currentModel,
  hasLastResponse,
  config,
  onSelect,
  onExit,
  theme,
}: Props): JSX.Element {
  const [items, setItems] = useState<Array<{ label: string; value: string }>>(
    [],
  );

  useEffect(() => {
    (async () => {
      if (isLoggingEnabled()) {
        log(`[codex] ModelOverlay: fetching models for provider ${config.provider}`);
      }
      const models = await getAvailableModels(config);
      if (isLoggingEnabled()) {
        log(`[codex] ModelOverlay: received ${models.length} models`);
      }

      // Split the list into recommended and “other” models.
      const recommended = RECOMMENDED_MODELS.filter((m) => models.includes(m));
      const others = models.filter((m) => !recommended.includes(m));

      const ordered = [...recommended, ...others.sort()];

      const newItems = ordered.map((m) => ({
        label: recommended.includes(m) ? `⭐ ${m}` : m,
        value: m,
      }));

      if (newItems.length === 0) {
        // Fallback: always include at least the current model
        newItems.push({ label: `(current) ${currentModel}`, value: currentModel });
      }

      setItems(newItems);
    })();
  }, [config, currentModel]);

  // Always register input handling so hooks are called consistently.
  useInput((_input, key) => {
    if (hasLastResponse && (key.escape || key.return)) {
      onExit();
    }
  });

  if (hasLastResponse) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={1}
        borderStyle="bold"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderLeftColor={theme.error}
        width={80}
        marginY={1}
      >
        <Box paddingX={1} marginBottom={1} gap={1}>
          <Text bold color={theme.error} inverse paddingX={1}> LOCKED </Text>
          <Text bold color={theme.error}>UNABLE TO SWITCH MODEL</Text>
        </Box>
        <Box paddingX={1} marginBottom={1}>
          <Text color={theme.dim}>
            You can only pick a model before the assistant sends its first
            response. To use a different model please start a new chat.
          </Text>
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
          <Text dimColor italic>press esc or enter to close</Text>
        </Box>
      </Box>
    );
  }

  return (
    <TypeaheadOverlay
      title="Switch model"
      description={
        <Text color={theme.dim}>
          CURRENT MODEL: <Text color={theme.success} bold>{currentModel}</Text>
        </Text>
      }
      initialItems={items}
      currentValue={currentModel}
      onSelect={onSelect}
      onExit={onExit}
      theme={theme}
    />
  );
}
