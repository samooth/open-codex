import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { CONFIG_DIR } from "../config.js";
import { pluginRegistry } from "./plugin-registry.js";
import { log, isLoggingEnabled } from "../agent/log.js";
import type { CodexPlugin } from "../agent/types.js";

export async function loadPlugins(): Promise<void> {
  const globalPluginsDir = path.join(CONFIG_DIR, "plugins");
  const localPluginsDir = path.join(process.cwd(), ".codex", "plugins");

  const pluginDirs = [globalPluginsDir, localPluginsDir];

  for (const dir of pluginDirs) {
    if (!fs.existsSync(dir)) {
      continue;
    }

    if (isLoggingEnabled()) {
      log(`Scanning for plugins in: ${dir}`);
    }

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".js") || file.endsWith(".mjs")) {
          const pluginPath = path.join(dir, file);
          await loadPluginFile(pluginPath);
        } else if (fs.statSync(path.join(dir, file)).isDirectory()) {
          // Check for index.js or index.mjs in subdirectory
          const indexJs = path.join(dir, file, "index.js");
          const indexMjs = path.join(dir, file, "index.mjs");
          if (fs.existsSync(indexJs)) {
            await loadPluginFile(indexJs);
          } else if (fs.existsSync(indexMjs)) {
            await loadPluginFile(indexMjs);
          }
        }
      }
    } catch (err) {
      log(`Error scanning plugin directory ${dir}: ${err}`);
    }
  }
}

async function loadPluginFile(filePath: string): Promise<void> {
  try {
    // We use pathToFileURL to ensure compatibility across platforms (especially Windows)
    const fileUrl = pathToFileURL(filePath).href;
    if (isLoggingEnabled()) {
      log(`Loading plugin from: ${fileUrl}`);
    }

    // Dynamic import
    const module = await import(fileUrl);
    const plugin: CodexPlugin = module.default || module.plugin;

    if (!plugin || !plugin.name || !plugin.tools || !plugin.handlers) {
      log(`Invalid plugin at ${filePath}: Missing required fields (name, tools, handlers)`);
      return;
    }

    pluginRegistry.register(plugin);
    if (isLoggingEnabled()) {
      log(`Registered plugin: ${plugin.name} v${plugin.version}`);
    }
  } catch (err) {
    log(`Failed to load plugin at ${filePath}: ${err}`);
  }
}
