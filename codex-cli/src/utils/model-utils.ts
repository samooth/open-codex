import type { AppConfig } from "./config";

import { listModels } from "@huggingface/hub";
import chalk from "chalk";
import OpenAI from "openai";
import { log, isLoggingEnabled } from "./agent/log.js";

const MODEL_LIST_TIMEOUT_MS = 2_000; // 2 seconds
export const RECOMMENDED_MODELS: Array<string> = ["o4-mini", "o3"];

/**
 * Background model loader / cache.
 *
 * We cache models per provider and base URL to avoid stale results when
 * switching providers (e.g. switching from OpenAI to local Ollama).
 */
const modelsCache = new Map<string, Promise<Array<string>>>();

async function fetchHuggingFaceModels(config: AppConfig): Promise<Array<string>> {
  const models: Array<string> = [];
  try {
    for await (const model of listModels({
      credentials: { accessToken: config.apiKey },
      filter: {
        tag: "tool-use",
        task: "text-generation",
      },
      sort: "downloads",
      direction: -1,
      limit: 50,
    })) {
      // Double-check the pipeline tag to be absolutely sure it's a text-generation LLM
      if (model.pipeline_tag === "text-generation") {
        models.push(model.name);
      }
    }
    return [...new Set(models)].sort();
  } catch (error) {
    return [];
  }
}

async function fetchModels(config: AppConfig): Promise<Array<string>> {
  // If the user has not configured an API key we cannot hit the network.
  if (!config.apiKey) {
    return [];
  }

  if (isLoggingEnabled()) {
    log(`[codex] Fetching models for provider: ${config.provider} (${config.baseURL})`);
  }

  if (config.provider === "hf") {
    return fetchHuggingFaceModels(config);
  }

  // Try standard OpenAI-compatible list first
  try {
    const openai = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
    const list = await openai.models.list();
    const models: Array<string> = [];
    for await (const model of list as AsyncIterable<{ id?: string }>) {
      if (model && typeof model.id === "string") {
        models.push(model.id);
      }
    }
    if (models.length > 0) {
      return models.sort();
    }
  } catch (err) {
    if (isLoggingEnabled()) {
      log(`[codex] Standard model list failed: ${err}`);
    }
  }

  // If the provider is Ollama, try the native /api/tags endpoint as fallback
  if (config.provider === "ollama" && config.baseURL) {
    try {
      // BaseURL is usually ".../v1", tags is at ".../api/tags"
      const tagsUrl = config.baseURL.replace(/\/v1\/?$/, "/api/tags");
      if (isLoggingEnabled()) {
        log(`[codex] Fetching Ollama models from: ${tagsUrl}`);
      }
      const response = await fetch(tagsUrl);
      if (response.ok) {
        const data = (await response.json()) as {
          models: Array<{ name: string }>;
        };
        const models = data.models.map((m) => m.name);
        return models.sort();
      }
    } catch (err) {
      if (isLoggingEnabled()) {
        log(`[codex] Ollama native tags fetch failed: ${err}`);
      }
    }
  }

  return [];
}

export function preloadModels(config: AppConfig): void {
  // Fire‑and‑forget – callers that truly need the list should `await`
  // `getAvailableModels()` instead.
  void getAvailableModels(config);
}

export async function getAvailableModels(
  config: AppConfig,
): Promise<Array<string>> {
  const cacheKey = `${config.provider}:${config.baseURL}`;
  let promise = modelsCache.get(cacheKey);

  if (!promise) {
    promise = fetchModels(config);
    modelsCache.set(cacheKey, promise);
  }

  return promise;
}

/**
 * Verify that the provided model identifier is present in the set returned by
 * {@link getAvailableModels}. The list of models is fetched from the OpenAI
 * `/models` endpoint the first time it is required and then cached in‑process.
 */
export async function isModelSupported(
  model: string | undefined | null,
  config: AppConfig,
): Promise<boolean> {
  if (
    typeof model !== "string" ||
    model.trim() === "" ||
    RECOMMENDED_MODELS.includes(model)
  ) {
    return true;
  }

  try {
    const models = await Promise.race<Array<string>>([
      getAvailableModels(config),
      new Promise<Array<string>>((resolve) =>
        setTimeout(() => resolve([]), MODEL_LIST_TIMEOUT_MS),
      ),
    ]);

    // If the timeout fired we get an empty list → treat as supported to avoid
    // false negatives.
    if (models.length === 0) {
      return true;
    }

    return models.includes(model.trim());
  } catch {
    // Network or library failure → don't block start‑up.
    return true;
  }
}

export function reportMissingAPIKeyForProvider(provider: string): void {
  // eslint-disable-next-line no-console
  console.error(
    (provider
      ? `\n${chalk.red("Missing API key for provider:")} ${provider}\n\n`
      : `\n${chalk.red("Missing API key:")}\n\n`) +
      (provider
        ? `Please set the following environment variable:\n`
        : "Please set one of the following environment variables:\n") +
      (() => {
        switch (provider) {
          case "openai":
            return `- ${chalk.bold("OPENAI_API_KEY")} for OpenAI models\n`;
          case "openrouter":
            return `- ${chalk.bold(
              "OPENROUTER_API_KEY",
            )} for OpenRouter models\n`;
          case "gemini":
          case "google":
            return `- ${chalk.bold(
              "GOOGLE_GENERATIVE_AI_API_KEY",
            )} for Google Gemini models\n`;
          case "xai":
            return `- ${chalk.bold("XAI_API_KEY")} for xAI models\n`;
          case "deepseek":
            return `- ${chalk.bold("DS_API_KEY")} for DeepSeek models\n`;
          case "hf":
            return `- ${chalk.bold("HF_API_KEY")} for Hugging Face models\n`;
          default:
            return (
              [
                `- ${chalk.bold("OPENAI_API_KEY")} for OpenAI models`,
                `- ${chalk.bold("OPENROUTER_API_KEY")} for OpenRouter models`,
                `- ${chalk.bold(
                  "GOOGLE_GENERATIVE_AI_API_KEY",
                )} for Google Gemini models`,
                `- ${chalk.bold("XAI_API_KEY")} for xAI models`,
                `- ${chalk.bold("DS_API_KEY")} for DeepSeek models`,
                `- ${chalk.bold("HF_API_KEY")} for Hugging Face models`,
              ].join("\n") + "\n"
            );
        }
      })() +
      `Then re-run this command.\n` +
      (() => {
        switch (provider) {
          case "openai":
            return `You can create an OpenAI key here: ${chalk.bold(
              chalk.underline("https://platform.openai.com/account/api-keys"),
            )}\n`;
          case "openrouter":
            return `You can create an OpenRouter key here: ${chalk.bold(
              chalk.underline("https://openrouter.ai/settings/keys"),
            )}\n`;
          case "gemini":
          case "google":
            return `You can create a Google Generative AI key here: ${chalk.bold(
              chalk.underline("https://aistudio.google.com/apikey"),
            )}\n`;
          case "xai":
            return `You can create an xAI key here: ${chalk.bold(
              chalk.underline("https://console.x.ai/team/default/api-keys"),
            )}\n`;
          case "deepseek":
            return `You can create a DeepSeek key here: ${chalk.bold(
              chalk.underline("https://platform.deepseek.com/api_keys"),
            )}\n`;
          case "hf":
            return `You can create a Hugging Face key here: ${chalk.bold(
              chalk.underline("https://huggingface.co/settings/tokens"),
            )}\n`;
          default:
            return "";
        }
      })(),
  );
}
