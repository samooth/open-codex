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

export class PluginManager {
  private plugins: Map<string, PluginTool> = new Map();
  private pluginsDir: string;

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
   * Dynamically loads all plugins from ~/.open-codex/plugins
   */
  public async loadPlugins(): Promise<void> {
    if (!existsSync(this.pluginsDir)) return;

    try {
      const files = readdirSync(this.pluginsDir).filter((f) =>
        f.endsWith(".js"),
      );
      for (const file of files) {
        const filePath = join(this.pluginsDir, file);
        try {
          // Use file URL for cross-platform dynamic import compatibility
          const fileUrl = pathToFileURL(filePath).href;
          const module = await import(fileUrl);

          if (module.default && this.isValidPlugin(module.default)) {
            const plugin = module.default as PluginTool;
            const name = (plugin.definition as any).function?.name || (plugin.definition as any).name;
            if (name) {
              this.plugins.set(name, plugin);
              log(`Loaded plugin tool: ${name} from ${file}`);
            } else {
              log(`Skipping plugin ${file}: Could not determine tool name.`);
            }
          } else {
            log(`Skipping invalid plugin: ${file} (must export default PluginTool)`);
          }
        } catch (e) {
          log(`Error loading plugin ${file}: ${e}`);
        }
      }
    } catch (e) {
      log(`Error reading plugins directory: ${e}`);
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
}
