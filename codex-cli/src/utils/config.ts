// NOTE: We intentionally point the TypeScript import at the source file
// (`./auto-approval-mode.ts`) instead of the emitted `.js` bundle.  This makes
// the module resolvable when the project is executed via `ts-node`, which
// resolves *source* paths rather than built artefacts.  During a production
// build the TypeScript compiler will automatically rewrite the path to
// `./auto-approval-mode.js`, so the change is completely transparent for the
// compiled `dist/` output used by the published CLI.

import { log, isLoggingEnabled } from "./agent/log.js";
import { AutoApprovalMode, FullAutoErrorMode } from "./auto-approval-mode.js";
import { reportMissingAPIKeyForProvider } from "./model-utils.js";
import { ThemeSchema } from "./theme.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { load as loadYaml, dump as dumpYaml } from "js-yaml";
import { homedir } from "os";
import { dirname, join, extname, resolve as resolvePath } from "path";
import { z } from "zod";

export const DEFAULT_APPROVAL_MODE = AutoApprovalMode.SUGGEST;
export const DEFAULT_INSTRUCTIONS = "";

export const CONFIG_DIR = join(homedir(), ".open-codex");
export const CONFIG_JSON_FILEPATH = join(CONFIG_DIR, "config.json");
export const CONFIG_YAML_FILEPATH = join(CONFIG_DIR, "config.yaml");
export const CONFIG_YML_FILEPATH = join(CONFIG_DIR, "config.yml");

// Keep the original constant name for backward compatibility, but point it at
// the default JSON path. Code that relies on this constant will continue to
// work unchanged.
export const CONFIG_FILEPATH = CONFIG_JSON_FILEPATH;
export const INSTRUCTIONS_FILEPATH = join(CONFIG_DIR, "instructions.md");

export const OPENAI_TIMEOUT_MS =
  parseInt(process.env["OPENAI_TIMEOUT_MS"] || "0", 10) || undefined;

// Canonical provider ids + their accepted aliases. Used so that users can
// refer to a provider by any of its names (e.g. "kilogateway" vs "kilocode")
// and still resolve keys/URLs stored under a different alias.
const PROVIDER_ALIASES: Record<string, Array<string>> = {
  opencode: ["opencode", "opencode-zen", "opencodezen", "opencode_zen"],
  kilocode: [
    "kilo",
    "kilocode",
    "kilogateway",
    "kilo-gateway",
    "kilo_gateway",
  ],
  "llama.cpp": [
    "llama.cpp",
    "llamacpp",
    "llama-cpp",
    "llama_cpp",
    "llamacpp-server",
  ],
};

export function canonicalProvider(provider: string): string {
  const lower = (provider || "").toLowerCase();
  for (const [canonical, aliases] of Object.entries(PROVIDER_ALIASES)) {
    if (aliases.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

export function providerAliases(provider: string): Array<string> {
  const canonical = canonicalProvider(provider);
  return PROVIDER_ALIASES[canonical] || [canonical];
}

export function getDefaultProvider(): string {
  if (process.env["OPENAI_API_KEY"]) {
    return "openai";
  }
  if (process.env["ANTHROPIC_API_KEY"]) {
    return "anthropic";
  }
  if (process.env["GEMINI_API_KEY"]) {
    return "google";
  }
  if (process.env["OLLAMA_BASE_URL"]) {
    return "ollama";
  }
  if (process.env["OPENROUTER_API_KEY"]) {
    return "openrouter";
  }
  if (process.env["XAI_API_KEY"]) {
    return "xai";
  }
  if (process.env["DS_API_KEY"]) {
    return "deepseek";
  }
  if (process.env["HF_API_KEY"]) {
    return "hf";
  }
  if (process.env["OPENCODE_API_KEY"] || process.env["OPENCODE_ZEN_API_KEY"]) {
    return "opencode";
  }
  if (
    process.env["KILOCODE_API_KEY"] ||
    process.env["KILO_API_KEY"] ||
    process.env["KILOGATEWAY_API_KEY"]
  ) {
    return "kilocode";
  }
  if (
    process.env["LLAMACPP_BASE_URL"] ||
    process.env["LLAMA_CPP_BASE_URL"] ||
    process.env["LLAMACPP_URL"]
  ) {
    return "llama.cpp";
  }
  return "openai";
}

function getAPIKeyForProviderOrExit(
  provider: string,
  providers?: Record<string, ProviderConfig>,
): string {
  const aliases = providerAliases(provider);
  let configKey: string | undefined;
  for (const id of aliases) {
    configKey = configKey || providers?.[id]?.apiKey;
  }

  if (!configKey && (provider === "google" || provider === "gemini")) {
    configKey = providers?.["google"]?.apiKey || providers?.["gemini"]?.apiKey;
  }

  if (configKey) {
    return configKey;
  }

  switch (provider) {
    case "openai":
      if (process.env["OPENAI_API_KEY"]) {
        return process.env["OPENAI_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "anthropic":
      if (process.env["ANTHROPIC_API_KEY"]) {
        return process.env["ANTHROPIC_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "gemini":
    case "google":
      if (process.env["GEMINI_API_KEY"]) {
        return process.env["GEMINI_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "openrouter":
      if (process.env["OPENROUTER_API_KEY"]) {
        return process.env["OPENROUTER_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "ollama":
      if (process.env["OLLAMA_API_KEY"]) {
        return process.env["OLLAMA_API_KEY"];
      } else {
        return "ollama";
      }
    case "xai":
      if (process.env["XAI_API_KEY"]) {
        return process.env["XAI_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "hf":
      if (process.env["HF_API_KEY"]) {
        return process.env["HF_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "deepseek":
      if (process.env["DS_API_KEY"]) {
        return process.env["DS_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "opencode":
    case "opencode-zen":
    case "opencodezen":
    case "opencode_zen":
      if (process.env["OPENCODE_API_KEY"]) {
        return process.env["OPENCODE_API_KEY"];
      }
      if (process.env["OPENCODE_ZEN_API_KEY"]) {
        return process.env["OPENCODE_ZEN_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "kilo":
    case "kilocode":
    case "kilogateway":
    case "kilo-gateway":
    case "kilo_gateway":
      if (process.env["KILOCODE_API_KEY"]) {
        return process.env["KILOCODE_API_KEY"];
      }
      if (process.env["KILO_API_KEY"]) {
        return process.env["KILO_API_KEY"];
      }
      if (process.env["KILOGATEWAY_API_KEY"]) {
        return process.env["KILOGATEWAY_API_KEY"];
      }
      reportMissingAPIKeyForProvider(provider);
      process.exit(1);
      break;
    case "llama.cpp":
    case "llamacpp":
    case "llama-cpp":
    case "llama_cpp":
    case "llamacpp-server":
      // Local server — no API key required.
      if (process.env["LLAMACPP_API_KEY"]) {
        return process.env["LLAMACPP_API_KEY"];
      }
      return "llama.cpp";
    default:
      reportMissingAPIKeyForProvider("");
      process.exit(1);
  }
}

/**
 * Maps a provider to an optional base‑URL environment variable. Returning a
 * non‑empty string lets the user override any stored configuration for that
 * provider from the environment (highest precedence).
 */
function resolveEnvBaseURL(provider: string): string {
  let url: string | undefined;
  switch (provider) {
    case "openai":
      url = process.env["OPENAI_BASE_URL"];
      break;
    case "ollama":
      url = process.env["OLLAMA_BASE_URL"];
      break;
    case "opencode":
    case "opencode-zen":
    case "opencodezen":
    case "opencode_zen":
      url = process.env["OPENCODE_BASE_URL"] || process.env["OPENCODE_ZEN_BASE_URL"];
      break;
    case "kilo":
    case "kilocode":
    case "kilogateway":
    case "kilo-gateway":
    case "kilo_gateway":
      url =
        process.env["KILOCODE_BASE_URL"] ||
        process.env["KILO_BASE_URL"] ||
        process.env["KILOGATEWAY_BASE_URL"];
      break;
    case "llama.cpp":
    case "llamacpp":
    case "llama-cpp":
    case "llama_cpp":
    case "llamacpp-server":
      url =
        process.env["LLAMACPP_BASE_URL"] ||
        process.env["LLAMA_CPP_BASE_URL"] ||
        process.env["LLAMACPP_URL"];
      break;
    default:
      url = undefined;
  }
  if (!url) {
    return "";
  }
  // Avoid double slashes at the boundary (e.g. ".../v1/" + "/chat/completions").
  return url.replace(/\/+$/, "");
}

export function baseURLForProvider(
  provider: string,
  providers?: Record<string, ProviderConfig>,
): string {
  // An explicit environment variable takes precedence over any stored config
  // (config.json / providers block). This lets users point the CLI at a custom
  // OpenAI‑compatible gateway via OPENAI_BASE_URL without editing config files.
  const envBaseURL = resolveEnvBaseURL(provider);
  if (envBaseURL) {
    return envBaseURL;
  }

  const aliases = providerAliases(provider);
  for (const id of aliases) {
    const aliasURL = providers?.[id]?.baseURL;
    if (aliasURL) {
      return aliasURL;
    }
  }
  const configURL = providers?.[provider]?.baseURL;
  if (configURL) {
    return configURL;
  }

  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "anthropic":
      return "https://api.anthropic.com";
    case "ollama":
      return process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434/v1";
    case "gemini":
    case "google":
      // The @google/genai SDK manages its own base URL.
      return "";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "xai":
      return "https://api.x.ai/v1";
    case "deepseek":
      return "https://api.deepseek.com/v1";
    case "hf":
      return "https://router.huggingface.co/v1";
    case "opencode":
    case "opencode-zen":
    case "opencodezen":
    case "opencode_zen":
      return "https://opencode.ai/zen/v1";
    case "kilo":
    case "kilocode":
    case "kilogateway":
    case "kilo-gateway":
    case "kilo_gateway":
      return "https://api.kilo.ai/api/gateway";
    case "llama.cpp":
    case "llamacpp":
    case "llama-cpp":
    case "llama_cpp":
    case "llamacpp-server":
      return "http://localhost:8080/v1";
    default:
      // TODO throw?
      return "";
  }
}

function defaultModelsForProvider(provider: string): {
  agentic: string;
  fullContext: string;
} {
  switch (provider) {
    case "openai":
      return {
        agentic: "o4-mini",
        fullContext: "gpt-5.2-codex",
      };
    case "anthropic":
      return {
        agentic: "claude-opus-4-6",
        fullContext: "claude-opus-4-6",
      };
    case "gemini":
    case "google":
      return {
        agentic: "gemini-2.5-flash",
        fullContext: "gemini-2.5-flash",
      };
    case "ollama":
      return {
        agentic: "llama3",
        fullContext: "llama3",
      };
    case "openrouter":
      return {
        agentic: "openai/gpt-5.2-codex",
        fullContext: "openai/gpt-5.2-codex",
      };
    case "xai":
      return {
        agentic: "grok-4-1-fast-reasoning",
        fullContext: "grok-4-1-fast-reasoning",
      };
    case "deepseek":
      return {
        agentic: "deepseek-chat",
        fullContext: "deepseek-reasoner",
      };
    case "hf":
      return {
        agentic: "moonshotai/Kimi-K2.5",
        fullContext: "moonshotai/Kimi-K2.5",
      };
    case "opencode":
    case "opencode-zen":
    case "opencodezen":
    case "opencode_zen":
      return {
        agentic: "gpt-5.2-codex",
        fullContext: "gpt-5.2-codex",
      };
    case "kilo":
    case "kilocode":
    case "kilogateway":
    case "kilo-gateway":
    case "kilo_gateway":
      return {
        agentic: "kilo-auto/balanced",
        fullContext: "kilo-auto/balanced",
      };
    case "llama.cpp":
    case "llamacpp":
    case "llama-cpp":
    case "llama_cpp":
    case "llamacpp-server":
      return {
        agentic: "",
        fullContext: "",
      };
    default:
      return {
        agentic: "",
        fullContext: "",
      };
  }
}

// Formatting (quiet mode-only).
export const PRETTY_PRINT = Boolean(process.env["PRETTY_PRINT"] || "");

export const MemoryConfigSchema = z.object({
  enabled: z.boolean(),
});

export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

export const ProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().optional(),
  extraBody: z.record(z.string(), z.any()).optional(),
  temperature: z.number().optional(),
  contextSize: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  maxTokens: z.number().optional(),
  seed: z.number().optional(),
  stop: z.array(z.string().min(1)).optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  repeatPenalty: z.number().optional(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const StoredConfigSchema = z.object({
  model: z.string().optional(),
  baseURL: z.string().optional(),
  provider: z.string().optional(),
  providers: z.record(z.string(), ProviderConfigSchema).optional(),
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
  pinnedFiles: z.array(z.string()).optional(),
  approvalMode: z.nativeEnum(AutoApprovalMode).optional(),
  fullAutoErrorMode: z.nativeEnum(FullAutoErrorMode).optional(),
  memory: MemoryConfigSchema.optional(),
  enableWebSearch: z.boolean().optional(),
  searxngUrl: z.string().optional(),
  serpApiKey: z.string().optional(),
  webSearchUrl: z.string().optional(),
  editorCommand: z.string().optional(),
  enableSmartContext: z.boolean().optional(),
  enableDeepLinter: z.boolean().optional(),
  enableDeepThinking: z.boolean().optional(),
  refreshSystemPrompt: z.boolean().optional(),
  embeddingModel: z.string().optional(),
  contextSize: z.number().optional(),
  temperature: z.number().optional(),
  topP: z.number().optional(),
  topK: z.number().optional(),
  maxTokens: z.number().optional(),
  seed: z.number().optional(),
  stop: z.array(z.string().min(1)).optional(),
  presencePenalty: z.number().optional(),
  frequencyPenalty: z.number().optional(),
  repeatPenalty: z.number().optional(),
  alwaysApprovedCommands: z.array(z.string()).optional(),
  theme: z.union([z.string(), ThemeSchema]).optional(),
  plugins: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
  skills: z.object({ paths: z.array(z.string()).optional() }).optional(),
});

// Represents config as persisted in config.json.
export type StoredConfig = z.infer<typeof StoredConfigSchema>;

// Minimal config written on first run.  An *empty* model string ensures that

// Represents full runtime config, including loaded instructions.
export type AppConfig = {
  apiKey?: string;
  baseURL?: string;
  provider?: string;
  providers?: Record<string, ProviderConfig>;
  mcpServers?: Record<string, McpServerConfig>;
  pinnedFiles?: Array<string>;
  model: string;
  instructions: string;
  approvalMode?: AutoApprovalMode;
  fullAutoErrorMode?: FullAutoErrorMode;
  memory?: MemoryConfig;
  dryRun?: boolean;
  allowAlwaysPatch?: boolean;
  skipSemanticMemory?: boolean;
  enableWebSearch?: boolean;
  searxngUrl?: string;
  serpApiKey?: string;
  webSearchUrl?: string;
  editorCommand?: string;
  enableSmartContext?: boolean;
  enableDeepLinter?: boolean;
  enableDeepThinking?: boolean;
  refreshSystemPrompt?: boolean;
  embeddingModel?: string;
  contextSize?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  seed?: number;
  stop?: Array<string>;
  presencePenalty?: number;
  frequencyPenalty?: number;
  repeatPenalty?: number;
  alwaysApprovedCommands?: Array<string>;
  theme?: string | z.infer<typeof ThemeSchema>;
  plugins?: Record<string, Record<string, unknown>>;
  skills?: {
    paths?: Array<string>;
  };
};

// ---------------------------------------------------------------------------
// Project doc support (open-codex.md)
// ---------------------------------------------------------------------------

export const PROJECT_DOC_MAX_BYTES = 32 * 1024; // 32 kB

const PROJECT_DOC_FILENAMES = [
  "open-codex.md",
  ".open-codex.md",
  "OPEN-CODEX.md",
  "codex.md",
  "CODEX.md",
];

export function discoverProjectDocPath(startDir: string): string | null {
  const cwd = resolvePath(startDir);

  // 1) Look in the explicit CWD first:
  for (const name of PROJECT_DOC_FILENAMES) {
    const direct = join(cwd, name);
    if (existsSync(direct)) {
      return direct;
    }
  }

  // 2) Fallback: walk up to the Git root and look there.
  let dir = cwd;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const gitPath = join(dir, ".git");
    if (existsSync(gitPath)) {
      // Once we hit the Git root, search its top‑level for the doc
      for (const name of PROJECT_DOC_FILENAMES) {
        const candidate = join(dir, name);
        if (existsSync(candidate)) {
          return candidate;
        }
      }
      // If Git root but no doc, stop looking.
      return null;
    }

    const parent = dirname(dir);
    if (parent === dir) {
      // Reached filesystem root without finding Git.
      return null;
    }
    dir = parent;
  }
}

/**
 * Load the project documentation markdown (codex.md) if present. If the file
 * exceeds {@link PROJECT_DOC_MAX_BYTES} it will be truncated and a warning is
 * logged.
 *
 * @param cwd The current working directory of the caller
 * @param explicitPath If provided, skips discovery and loads the given path
 */
export function loadProjectDoc(cwd: string, explicitPath?: string): string {
  let filepath: string | null = null;

  if (explicitPath) {
    filepath = resolvePath(cwd, explicitPath);
    if (!existsSync(filepath)) {
      // eslint-disable-next-line no-console
      console.warn(`codex: project doc not found at ${filepath}`);
      filepath = null;
    }
  } else {
    filepath = discoverProjectDocPath(cwd);
  }

  if (!filepath) {
    return "";
  }

  try {
    const buf = readFileSync(filepath);
    if (buf.byteLength > PROJECT_DOC_MAX_BYTES) {
      // eslint-disable-next-line no-console
      console.warn(
        `codex: project doc '${filepath}' exceeds ${PROJECT_DOC_MAX_BYTES} bytes – truncating.`,
      );
    }
    return buf.slice(0, PROJECT_DOC_MAX_BYTES).toString("utf-8");
  } catch {
    return "";
  }
}

export type LoadConfigOptions = {
  /** Working directory used for project doc discovery */
  cwd?: string;
  /** Disable inclusion of the project doc */
  disableProjectDoc?: boolean;
  /** Explicit path to project doc (overrides discovery) */
  projectDocPath?: string;
  /** Whether we are in fullcontext mode. */
  isFullContext?: boolean;
  /** Skip loading full memory (e.g. for semantic search) */
  skipMemory?: boolean;
  /** The provider to use. */
  provider?: string;
  /** Force the API key for testing purposes. */
  forceApiKeyForTest?: string;
};

export const loadInstructions = (
  instructionsPath: string | undefined = INSTRUCTIONS_FILEPATH,
  options: LoadConfigOptions = {},
): string => {
  const instructionsFilePathResolved =
    instructionsPath ?? INSTRUCTIONS_FILEPATH;
  const userInstructions = existsSync(instructionsFilePathResolved)
    ? readFileSync(instructionsFilePathResolved, "utf-8")
    : DEFAULT_INSTRUCTIONS;

  // Project doc support.
  const shouldLoadProjectDoc =
    !options.disableProjectDoc &&
    process.env["CODEX_DISABLE_PROJECT_DOC"] !== "1";

  let projectDoc = "";
  let projectDocPath: string | null = null;
  if (shouldLoadProjectDoc) {
    const cwd = options.cwd ?? process.cwd();
    projectDoc = loadProjectDoc(cwd, options.projectDocPath);
    projectDocPath = options.projectDocPath
      ? resolvePath(cwd, options.projectDocPath)
      : discoverProjectDocPath(cwd);

    if (projectDocPath) {
      if (isLoggingEnabled()) {
        log(
          `[codex] Loaded project doc from ${projectDocPath} (${projectDoc.length} bytes)`,
        );
      }
    } else {
      if (isLoggingEnabled()) {
        log(`[codex] No project doc found in ${cwd}`);
      }
    }
  }

  const combinedInstructions = [
    userInstructions,
    projectDoc ? `--- project-doc ---\n\n${projectDoc}` : "",
  ]
    .filter((s) => s && s.trim() !== "")
    .join("\n\n");

  try {
    // Always ensure the instructions file exists so users can edit it.
    if (!existsSync(instructionsFilePathResolved)) {
      const instrDir = dirname(instructionsFilePathResolved);
      if (!existsSync(instrDir)) {
        mkdirSync(instrDir, { recursive: true });
      }
      writeFileSync(instructionsFilePathResolved, userInstructions, "utf-8");
    }
  } catch {
    // Silently ignore any errors – failure to persist the defaults shouldn't
    // block the CLI from starting.  A future explicit `codex config` command
    // or `saveConfig()` call can handle (re‑)writing later.
  }

  return combinedInstructions;
};

export const loadConfig = (
  configPath: string | undefined = CONFIG_FILEPATH,
  instructionsPath: string | undefined = INSTRUCTIONS_FILEPATH,
  options: LoadConfigOptions = {},
): AppConfig => {
  // Determine the actual path to load. If the provided path doesn't exist and
  // the caller passed the default JSON path, automatically fall back to YAML
  // variants.
  let actualConfigPath = configPath;
  if (!existsSync(actualConfigPath)) {
    if (configPath === CONFIG_FILEPATH) {
      if (existsSync(CONFIG_YAML_FILEPATH)) {
        actualConfigPath = CONFIG_YAML_FILEPATH;
      } else if (existsSync(CONFIG_YML_FILEPATH)) {
        actualConfigPath = CONFIG_YML_FILEPATH;
      }
    }
  }

  if (isLoggingEnabled()) {
    log(
      `[codex] Loading config from: ${actualConfigPath} (exists: ${existsSync(actualConfigPath)})`,
    );
  }

  let storedConfig: StoredConfig = {};
  if (existsSync(actualConfigPath)) {
    const raw = readFileSync(actualConfigPath, "utf-8");
    if (isLoggingEnabled()) {
      log(`[codex] Config content: ${raw}`);
    }
    const ext = extname(actualConfigPath).toLowerCase();
    try {
      let parsed: unknown;
      if (ext === ".yaml" || ext === ".yml") {
        parsed = loadYaml(raw);
      } else {
        parsed = JSON.parse(raw);
      }

      const result = StoredConfigSchema.safeParse(parsed);
      if (result.success) {
        storedConfig = result.data;
        if (isLoggingEnabled()) {
          log(
            `[codex] Config parsed successfully: ${JSON.stringify(storedConfig)}`,
          );
        }
      } else {
        if (isLoggingEnabled()) {
          log(`[codex] Config validation failed: ${result.error.message}`);
        }
        // eslint-disable-next-line no-console
        console.warn(
          `[codex] Invalid config in ${actualConfigPath}. Using defaults.`,
        );
      }
    } catch {
      // If parsing fails, fall back to empty config to avoid crashing.
      storedConfig = {};
    }
  }

  const storedProvider =
    storedConfig.provider && storedConfig.provider.trim() !== ""
      ? storedConfig.provider.trim()
      : undefined;

  // Treat empty string ("" or whitespace) as absence so we can fall back to
  // the latest DEFAULT_MODEL.
  const storedModel =
    storedConfig.model && storedConfig.model.trim() !== ""
      ? storedConfig.model.trim()
      : undefined;

  const storedBaseURL =
    storedConfig.baseURL && storedConfig.baseURL.trim() !== ""
      ? storedConfig.baseURL.trim()
      : undefined;

  const effectiveProvider =
    options.provider ?? storedProvider ?? getDefaultProvider();

  const derivedModels = defaultModelsForProvider(effectiveProvider);

  const derivedModel =
    storedModel ||
    (options.isFullContext
      ? derivedModels?.fullContext
      : derivedModels?.agentic);

  const derivedBaseURL =
    baseURLForProvider(effectiveProvider, storedConfig.providers as any) ||
    (effectiveProvider === (storedProvider ?? getDefaultProvider())
      ? storedBaseURL
      : undefined) ||
    baseURLForProvider(effectiveProvider);

  const derivedProvider = effectiveProvider;
  const apiKeyForProvider =
    options.forceApiKeyForTest ??
    getAPIKeyForProviderOrExit(derivedProvider, storedConfig.providers as any);

  const config: AppConfig = {
    model: derivedModel,
    apiKey: apiKeyForProvider,
    provider: derivedProvider,
    providers: storedConfig.providers as any,
    mcpServers: storedConfig.mcpServers as any,
    pinnedFiles: storedConfig.pinnedFiles || [],
    baseURL: derivedBaseURL,
    instructions: loadInstructions(instructionsPath, options),
    approvalMode: storedConfig.approvalMode,
    fullAutoErrorMode: storedConfig.fullAutoErrorMode,
    memory: storedConfig.memory,
    skipSemanticMemory: false,
    enableWebSearch: storedConfig.enableWebSearch ?? true,
    searxngUrl: storedConfig.searxngUrl,
    serpApiKey:
      storedConfig.serpApiKey && storedConfig.serpApiKey.trim() !== ""
        ? storedConfig.serpApiKey
        : process.env["SERPER_API_KEY"] ||
          process.env["SERPAPI_API_KEY"] ||
          process.env["SERP_API_KEY"] ||
          undefined,
    webSearchUrl: storedConfig.webSearchUrl,
    editorCommand: storedConfig.editorCommand,
    enableSmartContext: storedConfig.enableSmartContext ?? true,
    enableDeepLinter: storedConfig.enableDeepLinter ?? false,
    enableDeepThinking: storedConfig.enableDeepThinking ?? false,
    refreshSystemPrompt: storedConfig.refreshSystemPrompt ?? true,
    embeddingModel: storedConfig.embeddingModel,
    contextSize:
      storedConfig.providers?.[effectiveProvider]?.contextSize ??
      storedConfig.contextSize,
    temperature:
      storedConfig.providers?.[effectiveProvider]?.temperature ??
      storedConfig.temperature,
    topP:
      storedConfig.providers?.[effectiveProvider]?.topP ?? storedConfig.topP,
    topK:
      storedConfig.providers?.[effectiveProvider]?.topK ?? storedConfig.topK,
    maxTokens:
      storedConfig.providers?.[effectiveProvider]?.maxTokens ??
      storedConfig.maxTokens,
    seed: storedConfig.providers?.[effectiveProvider]?.seed ?? storedConfig.seed,
    stop: (() => { const f = ((storedConfig.providers?.[effectiveProvider]?.stop ?? storedConfig.stop) || []).filter((x: string) => typeof x === 'string' && x.trim().length > 0); return f.length ? f : undefined; })(),
    presencePenalty:
      storedConfig.providers?.[effectiveProvider]?.presencePenalty ??
      storedConfig.presencePenalty,
    frequencyPenalty:
      storedConfig.providers?.[effectiveProvider]?.frequencyPenalty ??
      storedConfig.frequencyPenalty,
    repeatPenalty:
      storedConfig.providers?.[effectiveProvider]?.repeatPenalty ??
      storedConfig.repeatPenalty,
    alwaysApprovedCommands: storedConfig.alwaysApprovedCommands,
    theme: storedConfig.theme,
  };

  // -----------------------------------------------------------------------
  // First‑run bootstrap: if the configuration file (and/or its containing
  // directory) didn't exist we create them now so that users end up with a
  // materialised ~/.open-codex/config.json file on first execution.  This mirrors
  // what `saveConfig()` would do but without requiring callers to remember to
  // invoke it separately.
  //
  // We intentionally perform this *after* we have computed the final
  // `config` object so that we can just persist the resolved defaults.  The
  // write operations are guarded by `existsSync` checks so that subsequent
  // runs that already have a config will remain read‑only here.
  // -----------------------------------------------------------------------

  try {
    if (!existsSync(actualConfigPath)) {
      // Ensure the directory exists first.
      const dir = dirname(actualConfigPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Persist a minimal config – we include the `model` key but leave it as
      // an empty string so that `loadConfig()` treats it as "unset" and falls
      // back to whatever DEFAULT_MODEL is current at runtime.  This prevents
      // pinning users to an old default after upgrading Codex.
      const ext = extname(actualConfigPath).toLowerCase();
      // Empty stored config for initial bootstrap.
      const EMPTY_STORED_CONFIG: StoredConfig = { model: "" };
      const EMPTY_CONFIG_JSON = JSON.stringify(EMPTY_STORED_CONFIG, null, 2);

      if (ext === ".yaml" || ext === ".yml") {
        writeFileSync(actualConfigPath, dumpYaml(EMPTY_STORED_CONFIG), "utf-8");
      } else {
        writeFileSync(actualConfigPath, EMPTY_CONFIG_JSON, "utf-8");
      }
    }
  } catch {
    // Silently ignore any errors – failure to persist the defaults shouldn't
    // block the CLI from starting.  A future explicit `codex config` command
    // or `saveConfig()` call can handle (re‑)writing later.
  }

  if (process.env["DEBUG"]) {
    // Redact sensitive keys before logging.
    const configForLogging = JSON.parse(JSON.stringify(config));
    if (configForLogging.apiKey) {
      configForLogging.apiKey = `${configForLogging.apiKey.slice(0, 4)}...`;
    }
    if (configForLogging.serpApiKey) {
      configForLogging.serpApiKey = `${configForLogging.serpApiKey.slice(
        0,
        4,
      )}...`;
    }
    if (configForLogging.providers) {
      for (const key in configForLogging.providers) {
        if (configForLogging.providers[key].apiKey) {
          configForLogging.providers[
            key
          ].apiKey = `${configForLogging.providers[key].apiKey.slice(0, 4)}...`;
        }
      }
    }
    // eslint-disable-next-line no-console
    log(
      `[codex-debug] Final AppConfig: ${JSON.stringify(
        configForLogging,
        null,
        2,
      )}`,
    );
  }

  return config;
};

export const saveConfig = (
  config: AppConfig,
  configPath = CONFIG_FILEPATH,
  instructionsPath = INSTRUCTIONS_FILEPATH,
): void => {
  // If the caller passed the default JSON path *and* a YAML config already
  // exists on disk, save back to that YAML file instead to preserve the
  // user's chosen format.
  let targetPath = configPath;
  if (
    configPath === CONFIG_FILEPATH &&
    !existsSync(configPath) &&
    (existsSync(CONFIG_YAML_FILEPATH) || existsSync(CONFIG_YML_FILEPATH))
  ) {
    targetPath = existsSync(CONFIG_YAML_FILEPATH)
      ? CONFIG_YAML_FILEPATH
      : CONFIG_YML_FILEPATH;
  }

  const dir = dirname(targetPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const ext = extname(targetPath).toLowerCase();
  // Create the config object to save
  const configToSave: StoredConfig = {
    model: config.model,
    provider: config.provider,
    providers: config.providers,
    mcpServers: config.mcpServers,
    pinnedFiles: config.pinnedFiles,
    approvalMode: config.approvalMode,
    enableWebSearch: config.enableWebSearch,
    searxngUrl: config.searxngUrl,
    serpApiKey: config.serpApiKey,
    webSearchUrl: config.webSearchUrl,
    editorCommand: config.editorCommand,
    enableSmartContext: config.enableSmartContext,
    enableDeepLinter: config.enableDeepLinter,
    enableDeepThinking: config.enableDeepThinking,
    refreshSystemPrompt: config.refreshSystemPrompt,
    embeddingModel: config.embeddingModel,
    contextSize: config.contextSize,
    temperature: config.temperature,
    topP: config.topP,
    topK: config.topK,
    maxTokens: config.maxTokens,
    seed: config.seed,
    stop: (config.stop || []).filter((x: string) => typeof x === 'string' && x.trim().length > 0).length
      ? (config.stop || []).filter((x: string) => typeof x === 'string' && x.trim().length > 0)
      : undefined,
    presencePenalty: config.presencePenalty,
    frequencyPenalty: config.frequencyPenalty,
    repeatPenalty: config.repeatPenalty,
    alwaysApprovedCommands: config.alwaysApprovedCommands,
    theme: config.theme,
  };
  if (ext === ".yaml" || ext === ".yml") {
    writeFileSync(targetPath, dumpYaml(configToSave), "utf-8");
  } else {
    writeFileSync(targetPath, JSON.stringify(configToSave, null, 2), "utf-8");
  }

  writeFileSync(instructionsPath, config.instructions, "utf-8");
};
