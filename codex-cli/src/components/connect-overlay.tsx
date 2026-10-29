import type { Theme } from "../utils/theme.js";
import type { AppConfig } from "../utils/config.js";

import { useAppContext } from "../contexts/app-context.js";
import CenteredOverlay from "./centered-overlay.js";
import SelectInput from "./select-input/select-input.js";
import TextInput from "./vendor/ink-text-input.js";
import { saveConfig } from "../utils/config.js";
import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";

/**
 * Provider catalog mirroring Kilo's provider-catalog: id, display name,
 * optional env var that can supply the key, and a default base URL hint
 * for self-hosted providers.
 */
const PROVIDER_CATALOG: Array<{
  id: string;
  name: string;
  envKey?: string;
  envUrl?: string;
  needsKey: boolean;
}> = [
  { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY", needsKey: true },
  {
    id: "anthropic",
    name: "Anthropic",
    envKey: "ANTHROPIC_API_KEY",
    needsKey: true,
  },
  { id: "google", name: "Google (Gemini)", envKey: "GEMINI_API_KEY", needsKey: true },
  {
    id: "openrouter",
    name: "OpenRouter",
    envKey: "OPENROUTER_API_KEY",
    needsKey: true,
  },
  { id: "xai", name: "xAI (Grok)", envKey: "XAI_API_KEY", needsKey: true },
  {
    id: "deepseek",
    name: "DeepSeek",
    envKey: "DS_API_KEY",
    needsKey: true,
  },
  { id: "hf", name: "Hugging Face", envKey: "HF_API_KEY", needsKey: true },
  {
    id: "opencode",
    name: "OpenCode Zen",
    envKey: "OPENCODE_API_KEY",
    needsKey: true,
  },
  {
    id: "kilocode",
    name: "Kilo Gateway",
    envKey: "KILOCODE_API_KEY",
    needsKey: true,
  },
  {
    id: "llama.cpp",
    name: "llama.cpp (local)",
    envUrl: "LLAMACPP_BASE_URL",
    needsKey: false,
  },
  {
    id: "ollama",
    name: "Ollama (local)",
    envUrl: "OLLAMA_BASE_URL",
    needsKey: false,
  },
];

type Stage = "list" | "configure" | "done";

function providerStatus(
  id: string,
  envKey: string | undefined,
  config: AppConfig,
): "connected" | "missing-key" {
  const configured = config.providers?.[id]?.apiKey;
  const fromEnv = envKey ? process.env[envKey] : undefined;
  if (configured || fromEnv) {
    return "connected";
  }
  return "missing-key";
}

export default function ConnectOverlay({
  theme,
  onExit,
}: {
  theme: Theme;
  onExit: () => void;
}): React.ReactElement {
  const { config, setConfig } = useAppContext();
  const [stage, setStage] = useState<Stage>("list");
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");

  const catalogWithStatus = useMemo(
    () =>
      PROVIDER_CATALOG.map((p) => ({
        ...p,
        status: providerStatus(p.id, p.envKey, config),
      })),
    [config],
  );

  const provider = catalogWithStatus.find((p) => p.id === selectedProvider);

  const finishConnect = (providerId: string, key: string, url: string) => {
    setConfig((prev) => ({
      ...prev,
      provider: providerId,
      providers: {
        ...(prev.providers ?? {}),
        [providerId]: {
          ...(prev.providers?.[providerId] ?? {}),
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          ...(url.trim() ? { baseURL: url.trim() } : {}),
        },
      },
    }));
    try {
      const stored = { ...config };
      stored.provider = providerId;
      stored.providers = {
        ...(config.providers ?? {}),
        [providerId]: {
          ...(config.providers?.[providerId] ?? {}),
          ...(key.trim() ? { apiKey: key.trim() } : {}),
          ...(url.trim() ? { baseURL: url.trim() } : {}),
        },
      };
      saveConfig(stored);
    } catch {
      // best-effort persistence; the runtime switch still applies
    }
    setStage("done");
  };

  useInput(
    (_input, key) => {
      if (key.escape) {
        if (stage === "configure") {
          setStage("list");
          setSelectedProvider(null);
          setApiKey("");
          setBaseURL("");
        } else if (stage === "done") {
          setStage("list");
          setSelectedProvider(null);
        }
        // The CenteredOverlay wrapper handles Escape on the list stage.
        else if (stage === "list") {
          onExit();
        }
      }
      if (stage === "done" && key.return) {
        onExit();
      }
      if (stage === "configure" && selectedProvider && key.return) {
        finishConnect(selectedProvider, apiKey, baseURL);
      }
    },
    { isActive: true },
  );

  if (stage === "done" && provider) {
    return (
      <CenteredOverlay
        title="connect"
        description={`${provider.name} is now the active provider.`}
        footer="enter close"
        theme={theme}
        onExit={onExit}
      >
        <Box flexDirection="column" gap={1}>
          <Text color={theme.success}>✓ {provider.name} connected</Text>
          <Text color={theme.dim}>
            Switch models with /model. Keys are stored in ~/.open-codex/config.json.
          </Text>
        </Box>
      </CenteredOverlay>
    );
  }

  if (stage === "configure" && provider) {
    return (
      <CenteredOverlay
        title={`connect · ${provider.name}`}
        description={
          provider.needsKey
            ? "Paste your API key. Leave base URL empty for the official endpoint."
            : "Local provider — set a base URL (e.g. http://localhost:11434/v1)."
        }
        footer="enter save · esc back"
        theme={theme}
        onExit={() => {
          setStage("list");
          setSelectedProvider(null);
        }}
      >
        <Box flexDirection="column" gap={1}>
          <Box gap={1}>
            <Text color={theme.dim}>key</Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              placeholder={provider.needsKey ? "sk-…" : "(not required)"}
              focus={provider.needsKey}
            />
          </Box>
          <Box gap={1}>
            <Text color={theme.dim}>url</Text>
            <TextInput
              value={baseURL}
              onChange={setBaseURL}
              placeholder={
                provider.id === "ollama" ? "http://localhost:11434/v1" : "(default)"
              }
              focus={!provider.needsKey}
            />
          </Box>
          <Box marginTop={1}>
            <Text color={theme.highlight}>
              press enter to save and activate {provider.name}
            </Text>
          </Box>
        </Box>
      </CenteredOverlay>
    );
  }

  return (
    <CenteredOverlay
      title="connect"
      description="Pick a provider to configure and activate it."
      footer="↑↓ navigate · enter configure · esc close"
      theme={theme}
      onExit={onExit}
    >
      <Box flexDirection="column" gap={0}>
        <Box marginBottom={1}>
          <Text color={theme.dim}>
            {providerStatus("openai", "OPENAI_API_KEY", config) === "connected"
              ? ""
              : ""}
          </Text>
        </Box>
        <SelectInput
          items={catalogWithStatus.map((p) => ({
            key: p.id,
            label: `${p.status === "connected" ? "●" : "○"} ${p.name}`,
            value: p.id,
            description:
              p.status === "connected" ? "configured" : "not configured",
          }))}
          onSelect={(item) => {
            const selected = catalogWithStatus.find(
              (p) => p.id === item.value,
            );
            setSelectedProvider(item.value);
            setApiKey("");
            setBaseURL(
              selected?.id === "ollama" && process.env["OLLAMA_BASE_URL"]
                ? process.env["OLLAMA_BASE_URL"]
                : "",
            );
            setStage("configure");
          }}
          theme={theme}
          isFocused={true}
        />
        <Box marginTop={1}>
          <Text color={theme.dim}>● configured · ○ needs setup</Text>
        </Box>
      </Box>
    </CenteredOverlay>
  );
}
