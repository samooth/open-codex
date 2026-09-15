import { existsSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { log } from "./log.js";
import type { AgentContext } from "./types.js";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions.mjs";
import { pathToFileURL } from "url";

export interface PluginTool {
  definition: ChatCompletionTool;
  handler: (
    ctx: AgentContext,
    args: string,
  ) => Promise<{
    outputText: string;
    metadata: Record<string, unknown>;
    additionalItems?: Array<ChatCompletionMessageParam>;
  }>;
}

/**
 * Shape exported by opencode-style plugin modules:
 *
 *   export default async (input, options) => ({
 *     tool: { my_tool: { definition, handler } },
 *     "experimental.chat.system.transform": (input, output) => { ... },
 *     dispose: async () => { ... },
 *   })
 */
export interface PluginModule {
  (input: unknown, options: Record<string, unknown>): Promise<{
    tool?: Record<string, PluginTool>;
    "experimental.chat.system.transform"?: (
      input: unknown,
      output: { system: Array<ChatCompletionMessageParam> },
    ) => void | Promise<void>;
    dispose?: () => Promise<void> | void;
  }>;
}

export class PluginManager {
  private plugins: Map<string, PluginTool> = new Map();
  private pluginsDir: string;
  private disposeFns: Array<() => Promise<void> | void> = [];
  private systemTransforms: Array<
    (input: unknown, output: { system: Array<ChatCompletionMessageParam> }) => void | Promise<void>
  > = [];

  constructor() {
    this.pluginsDir = join(homedir(), ".open-codex", "plugins");
    if (!existsSync(this.pluginsDir)) {
      try {
        mkdirSync(this.pluginsDir, { recursive: true });
      } catch (e) {
        log(`Failed to create plugins directory: ${e}`);
      }
    }
  }

  /**
   * Dynamically loads all plugins from ~/.open-codex/plugins.
   * Supports both legacy `{ definition, handler }` shape and opencode
   * function shape. Runs dispose hooks in reverse-load order on exit.
   */
  public async loadPlugins(options?: Record<string, Record<string, unknown>>): Promise<void> {
    if (!existsSync(this.pluginsDir)) return;

    try {
      const files = readdirSync(this.pluginsDir).filter((f) =>
        f.endsWith(".js") || f.endsWith(".ts"),
      );
      for (const file of files) {
        const filePath = join(this.pluginsDir, file);
        try {
          const fileUrl = pathToFileURL(filePath).href;
          const module = await import(fileUrl);

          if (!module.default) {
            log(`Skipping plugin ${file}: no default export`);
            continue;
          }

          // Try opencode function shape first
          if (typeof module.default === "function") {
            await this.loadFunctionShapePlugin(file, module.default as PluginModule, options);
            continue;
          }

          // Legacy shape
          if (this.isValidPlugin(module.default)) {
            const plugin = module.default as PluginTool;
            const name =
              (plugin.definition as any).function?.name ||
              (plugin.definition as any).name;
            if (name) {
              this.plugins.set(name, plugin);
              log(`Loaded plugin tool: ${name} from ${file}`);
            } else {
              log(`Skipping plugin ${file}: Could not determine tool name.`);
            }
          } else {
            log(`Skipping invalid plugin ${file}: must export default PluginTool or a plugin function`);
          }
        } catch (e) {
          log(`Error loading plugin ${file}: ${e}`);
        }
      }
    } catch (e) {
      log(`Error reading plugins directory: ${e}`);
    }
  }

  private async loadFunctionShapePlugin(
    file: string,
    fn: PluginModule,
    options?: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    try {
      const pluginName = file.replace(/\.(js|ts)$/, "");
      const pluginOptions = options?.[pluginName] ?? {};
      const result = await fn({}, pluginOptions);

      if (result.tool) {
        for (const [name, tool] of Object.entries(result.tool)) {
          this.plugins.set(name, tool);
          log(`Loaded plugin tool: ${name} from ${file}`);
        }
      }

      if (result["experimental.chat.system.transform"]) {
        this.systemTransforms.push(result["experimental.chat.system.transform"]);
      }

      if (result.dispose) {
        this.disposeFns.push(result.dispose);
      }
    } catch (e) {
      log(`Error loading function-shape plugin ${file}: ${e}`);
    }
  }

  private isValidPlugin(obj: any): obj is PluginTool {
    return (
      obj &&
      typeof obj.handler === "function" &&
      obj.definition &&
      obj.definition.type === "function" &&
      obj.definition.function &&
      typeof obj.definition.function.name === "string"
    );
  }

  public getAllDefinitions(): Array<ChatCompletionTool> {
    return Array.from(this.plugins.values()).map((p) => p.definition);
  }

  public getHandler(name: string) {
    return this.plugins.get(name)?.handler;
  }

  public hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  public registerTool(name: string, tool: PluginTool): void {
    this.plugins.set(name, tool);
  }

  public registerSystemTransform(
    transform: (
      input: unknown,
      output: { system: Array<ChatCompletionMessageParam> },
    ) => void | Promise<void>,
  ): void {
    this.systemTransforms.push(transform);
  }

  public getPluginCount(): number {
    return this.plugins.size;
  }

  /**
   * Apply all registered system-prompt transforms. Called from agent-loop
   * during prompt assembly.
   */
  public async applySystemTransforms(
    input: unknown,
    systemMessages: Array<ChatCompletionMessageParam>,
  ): Promise<void> {
    const output = { system: systemMessages };
    for (const transform of this.systemTransforms) {
      try {
        await transform(input, output);
      } catch (e) {
        log(`System transform error: ${e}`);
      }
    }
  }

  /**
   * Call all dispose hooks. Used on CLI shutdown.
   */
  public async disposeAll(timeoutMs = 3000): Promise<void> {
    await Promise.allSettled(
      this.disposeFns.map(async (fn) => {
        try {
          await Promise.race([
            fn(),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error("dispose timeout")), timeoutMs),
            ),
          ]);
        } catch (e) {
          log(`Plugin dispose error: ${e}`);
        }
      }),
    );
    this.disposeFns = [];
    this.systemTransforms = [];
    this.plugins.clear();
  }
}
