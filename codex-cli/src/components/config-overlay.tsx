import type { Theme } from "../utils/theme.js";

import SelectInput from "./select-input/select-input.js";
import { useAppContext } from "../contexts/app-context.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

type Props = {
  onExit: () => void;
  theme: Theme;
};

export default function ConfigOverlay({
  onExit,
  theme,
}: Props): React.ReactElement {
  const { config, setConfig, openOverlay } = useAppContext();

  const items = [
    {
      label: `DRY RUN: ${config.dryRun ? "ENABLED" : "DISABLED"}`,
      value: "dryRun",
      description: "Preview changes without modifying actual files.",
    },
    {
      label: `DEBUG LOGGING: ${process.env["DEBUG"] ? "ACTIVE" : "INACTIVE"}`,
      value: "debug",
      description: "Enable verbose logging for troubleshooting.",
    },
    {
      label: `EDITOR COMMAND: ${config.editorCommand || "DEFAULT"}`,
      value: "editorCommand",
      description: `Command: ${config.editorCommand || "$EDITOR / $VISUAL"}. Select to change.`,
    },
    {
      label: `WEB SEARCH: ${config.enableWebSearch ? "ENABLED" : "DISABLED"}`,
      value: "webSearch",
      description: "Allow the agent to search the web for information.",
    },
    {
      label: `SEARXNG INSTANCE: ${config.searxngUrl ? "CONFIGURED" : "NONE"}`,
      value: "searxngUrl",
      description: `JSON API: ${config.searxngUrl || "Not set (falls back to scraping)"}.`,
    },
    {
      label: `SERP API KEY: ${config.serpApiKey ? "CONFIGURED" : "NONE"}`,
      value: "serpApiKey",
      description: `API Key for serper.dev / search providers.`,
    },
    {
      label: `GENERIC SEARCH: ${config.webSearchUrl ? "CUSTOM" : "DUCKDUCKGO"}`,
      value: "webSearchUrl",
      description: `URL: ${config.webSearchUrl || "https://html.duckduckgo.com"}.`,
    },
    {
      label: `SMART CONTEXT: ${config.enableSmartContext ? "ENABLED" : "DISABLED"}`,
      value: "smartContext",
      description:
        "Automatically pin frequently accessed files to the context.",
    },
    {
      label: `AUTO LINTING: ${config.enableDeepLinter ? "ENABLED" : "DISABLED"}`,
      value: "deepLinter",
      description:
        "Automatically run project linters after each file modification.",
    },
    {
      label: `DEEP THINKING: ${config.enableDeepThinking ? "ACTIVE" : "INACTIVE"}`,
      value: "deepThinking",
      description: "Force models to use thorough reasoning subroutine.",
    },
    {
      label: `REFRESH SYSTEM PROMPT: ${config.refreshSystemPrompt ? "ON" : "OFF"}`,
      value: "refreshSystemPrompt",
      description:
        "Inject system instructions every turn (Stateless fallback).",
    },
    {
      label: "CLOSE",
      value: "exit",
      description: "Return to the chat session.",
    },
  ];

  const [selectedDescription, setSelectedDescription] = useState(
    items[0]!.description,
  );

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (item: { value: string }) => {
    if (item.value === "dryRun") {
      setConfig((prev) => ({ ...prev, dryRun: !prev.dryRun }));
    } else if (item.value === "debug") {
      if (process.env["DEBUG"]) {
        delete process.env["DEBUG"];
      } else {
        process.env["DEBUG"] = "1";
      }
    } else if (item.value === "editorCommand") {
      // This will need to be handled by the parent still, as it controls overlays
      openOverlay("editor");
    } else if (item.value === "webSearch") {
      setConfig((prev) => ({
        ...prev,
        enableWebSearch: !prev.enableWebSearch,
      }));
    } else if (item.value === "searxngUrl") {
      openOverlay("search-url-searxng");
    } else if (item.value === "serpApiKey") {
      openOverlay("serp-api-key");
    } else if (item.value === "webSearchUrl") {
      openOverlay("search-url-generic");
    } else if (item.value === "smartContext") {
      setConfig((prev) => ({
        ...prev,
        enableSmartContext: !prev.enableSmartContext,
      }));
    } else if (item.value === "deepLinter") {
      setConfig((prev) => ({
        ...prev,
        enableDeepLinter: !prev.enableDeepLinter,
      }));
    } else if (item.value === "deepThinking") {
      setConfig((prev) => ({
        ...prev,
        enableDeepThinking: !prev.enableDeepThinking,
      }));
    } else if (item.value === "refreshSystemPrompt") {
      setConfig((prev) => ({
        ...prev,
        refreshSystemPrompt: !prev.refreshSystemPrompt,
      }));
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
        <Box backgroundColor={theme.highlight as any} paddingX={1}>
          <Text bold color="black">
            {" "}
            SETTINGS{" "}
          </Text>
        </Box>
        <Text color={theme.highlight} bold>
          CONFIGURATION DASHBOARD
        </Text>
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <SelectInput
          items={items}
          onSelect={handleSelect}
          onHighlight={handleHighlight as any}
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
        <Text italic color={theme.dim}>
          {selectedDescription}
        </Text>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Text dimColor>↑↓ navigate │ enter toggle │ esc close</Text>
      </Box>
    </Box>
  );
}
