import type { CodexPlugin, PluginContext, ToolResult } from "../agent/types.js";

export class PluginRegistry {
  private plugins: Map<string, CodexPlugin> = new Map();

  /**
   * Registers a new plugin.
   */
  public register(plugin: CodexPlugin): void {
    this.plugins.set(plugin.name, plugin);
  }

  /**
   * Removes a plugin by name.
   */
  public unregister(name: string): void {
    this.plugins.delete(name);
  }

  /**
   * Returns all registered plugins.
   */
  public getAll(): CodexPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Returns all tool definitions from all plugins.
   */
  public getTools(): any[] {
    return Array.from(this.plugins.values()).flatMap(p => p.tools);
  }

  /**
   * Finds a tool handler by name across all plugins.
   */
  public getHandler(toolName: string): ((args: any, ctx: PluginContext) => Promise<ToolResult>) | undefined {
    for (const plugin of this.plugins.values()) {
      if (plugin.handlers[toolName]) {
        return plugin.handlers[toolName];
      }
    }
    return undefined;
  }

  /**
   * Returns all system instructions from all plugins combined.
   */
  public getSystemInstructions(): string {
    return Array.from(this.plugins.values())
      .map(p => p.systemInstructions)
      .filter(Boolean)
      .join("\n\n");
  }
}

// Global instance
export const pluginRegistry = new PluginRegistry();
