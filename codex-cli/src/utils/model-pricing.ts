import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * @fileoverview
 * This file contains the pricing information for various language models.
 * Prices are typically specified per million tokens for input and output.
 *
 * To add a new model, add an entry to the `MODEL_PRICING` object.
 *
 * --- User Overrides ---
 * Users can override or extend this pricing list by creating a JSON file at:
 * ~/.config/codex/pricing.json
 *
 * The structure should be the same as `MODEL_PRICING` below.
 * TODO: Consider fetching this from a remote source to keep it up-to-date.
 */

export interface ModelPricing {
  input: number; // Cost per 1 million input tokens in USD
  output: number; // Cost per 1 million output tokens in USD
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // --- OpenAI ---
  "gpt-4-turbo": {
    input: 10.0,
    output: 30.0,
  },
  "gpt-4": {
    input: 30.0,
    output: 60.0,
  },
  "gpt-3.5-turbo": {
    input: 0.5,
    output: 1.5,
  },

  // --- Anthropic ---
  "claude-3-opus-20240229": {
    input: 15.0,
    output: 75.0,
  },
  "claude-3-sonnet-20240229": {
    input: 3.0,
    output: 15.0,
  },

  // --- Groq ---
  "llama3-8b-8192": {
    input: 0.05,
    output: 0.1,
  },
  "llama3-70b-8192": {
    input: 0.59,
    output: 0.79,
  },
};

let mergedPricing: Record<string, ModelPricing> | null = null;

/**
 * Loads pricing from the user's config directory, merges it with the
 * default pricing, and caches the result.
 * @returns The merged pricing information.
 */
function getMergedPricing(): Record<string, ModelPricing> {
  if (mergedPricing) {
    return mergedPricing;
  }

  const userConfigPath = path.join(
    os.homedir(),
    ".config",
    "codex",
    "pricing.json",
  );
  let userPricing: Record<string, ModelPricing> = {};

  try {
    if (fs.existsSync(userConfigPath)) {
      const userConfigFile = fs.readFileSync(userConfigPath, "utf-8");
      userPricing = JSON.parse(userConfigFile) as Record<string, ModelPricing>;
    }
  } catch (error) {
    // If the user's config is malformed or unreadable, we'll log an error
    // but continue with the default pricing.
    console.error(
      `[Codex] Error loading user pricing config from ${userConfigPath}:`,
      error,
    );
  }

  mergedPricing = { ...MODEL_PRICING, ...userPricing };
  return mergedPricing;
}

/**
 * Resets the cached pricing data.
 * NOTE: This is intended for use in testing environments only.
 */
export function resetCachedPricing() {
  mergedPricing = null;
}

/**
 * Retrieves the pricing for a given model.
 * @param modelName The name of the model.
 * @returns The pricing information, or null if not found.
 */
export function getModelPricing(modelName: string): ModelPricing | null {
  const allPricing = getMergedPricing();
  const sortedKeys = Object.keys(allPricing).sort(
    (a, b) => b.length - a.length,
  );

  for (const key of sortedKeys) {
    if (modelName.includes(key)) {
      // With `noUncheckedIndexedAccess`, this could be `undefined`.
      // We know it's safe, but we cast to satisfy the type-checker.
      return allPricing[key] as ModelPricing;
    }
  }
  return null; // Explicitly return null if no match is found
}
