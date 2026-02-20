import SelectInput from "./select-input/select-input.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";
import type { Theme } from "../utils/theme.js";

type Props = {
  dryRun: boolean;
  debug: boolean;
  enableWebSearch: boolean;
  enableDeepThinking: boolean;
  enableDeepLinter: boolean;
  enableSmartContext: boolean;
  searxngUrl?: string;
  webSearchUrl?: string;
  editorCommand?: string;
  onToggleDryRun: () => void;
  onToggleDebug: () => void;
  onToggleWebSearch: () => void;
  onToggleDeepThinking: () => void;
  onToggleDeepLinter: () => void;
  onToggleSmartContext: () => void;
  onEditSearchUrl: (type: "searxng" | "generic") => void;
  onEditEditorCommand: () => void;
  onExit: () => void;
  theme: Theme;
};

export default function ConfigOverlay({
  dryRun,
  debug,
  enableWebSearch,
  enableDeepThinking,
  enableDeepLinter,
  enableSmartContext,
  searxngUrl,
  webSearchUrl,
  editorCommand,
  onToggleDryRun,
  onToggleDebug,
  onToggleWebSearch,
  onToggleDeepThinking,
  onToggleDeepLinter,
  onToggleSmartContext,
  onEditSearchUrl,
  onEditEditorCommand,
  onExit,
  theme,
}: Props): JSX.Element {
  const items = [
    {
      label: `DRY RUN: ${dryRun ? "ENABLED" : "DISABLED"}`,
      value: "dryRun",
      description: "Preview changes without modifying actual files.",
    },
    {
      label: `DEBUG LOGGING: ${debug ? "ACTIVE" : "INACTIVE"}`,
      value: "debug",
      description: "Enable verbose logging for troubleshooting.",
    },
    {
      label: `EDITOR COMMAND: ${editorCommand || "DEFAULT"}`,
      value: "editorCommand",
      description: `Command: ${editorCommand || "$EDITOR / $VISUAL"}. Select to change.`,
    },
    {
      label: `WEB SEARCH: ${enableWebSearch ? "ENABLED" : "DISABLED"}`,
      value: "webSearch",
      description: "Allow the agent to search the web for information.",
    },
    {
      label: `SEARXNG INSTANCE: ${searxngUrl ? "CONFIGURED" : "NONE"}`,
      value: "searxngUrl",
      description: `JSON API: ${searxngUrl || "Not set (falls back to scraping)"}.`,
    },
    {
      label: `GENERIC SEARCH: ${webSearchUrl ? "CUSTOM" : "DUCKDUCKGO"}`,
      value: "webSearchUrl",
      description: `URL: ${webSearchUrl || "https://html.duckduckgo.com"}.`,
    },
    {
      label: `SMART CONTEXT: ${enableSmartContext ? "ENABLED" : "DISABLED"}`,
      value: "smartContext",
      description: "Automatically pin frequently accessed files to the context.",
    },
    {
      label: `AUTO LINTING: ${enableDeepLinter ? "ENABLED" : "DISABLED"}`,
      value: "deepLinter",
      description: "Automatically run project linters after each file modification.",
    },
    {
      label: `DEEP THINKING: ${enableDeepThinking ? "ACTIVE" : "INACTIVE"}`,
      value: "deepThinking",
      description: "Force models to use thorough reasoning subroutine.",
    },
    {
      label: "CLOSE",
      value: "exit",
      description: "Return to the chat session.",
    },
  ];

  const [selectedDescription, setSelectedDescription] = useState(items[0]!.description);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (item: { value: string }) => {
    if (item.value === "dryRun") {
      onToggleDryRun();
    } else if (item.value === "debug") {
      onToggleDebug();
    } else if (item.value === "editorCommand") {
      onEditEditorCommand();
    } else if (item.value === "webSearch") {
      onToggleWebSearch();
    } else if (item.value === "searxngUrl") {
      onEditSearchUrl("searxng");
    } else if (item.value === "webSearchUrl") {
      onEditSearchUrl("generic");
    } else if (item.value === "smartContext") {
      onToggleSmartContext();
    } else if (item.value === "deepLinter") {
      onToggleDeepLinter();
    } else if (item.value === "deepThinking") {
      onToggleDeepThinking();
    } else if (item.value === "exit") {
      onExit();
    }
  };

  const handleHighlight = (item: { description: string }) => {
    setSelectedDescription(item.description);
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
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Text bold color={theme.highlight} inverse paddingX={1}> SETTINGS </Text>
        <Text color={theme.highlight} bold>CONFIGURATION DASHBOARD</Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          onHighlight={handleHighlight}
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
        <Text italic color={theme.dim}>{selectedDescription}</Text>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>↑↓ navigate │ enter toggle │ esc close</Text>
      </Box>
    </Box>
  );
}
