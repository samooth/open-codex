import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { log } from "./log.js";
import { PluginManager, type PluginTool } from "./plugin-manager.js";
import { pathToFileURL } from "url";

export interface SkillManifest {
  name: string;
  description?: string;
  author?: string;
  version?: string;
  enabled?: boolean;
}

export interface LoadedSkill {
  manifest: SkillManifest;
  path: string;
  origin: string;
  tools: Array<PluginTool>;
  dispose?: () => Promise<void> | void;
}

export class SkillManager {
  private skills: Map<string, LoadedSkill> = new Map();
  private pluginManager: PluginManager;
  private searchPaths: Array<string>;

  constructor(
    pluginManager: PluginManager,
    searchPaths: Array<string> = [],
  ) {
    this.pluginManager = pluginManager;
    this.searchPaths = searchPaths;
  }

  /**
   * Default search paths, ordered by precedence (first match wins).
   * Project-local paths are resolved relative to cwd; global paths are absolute.
   */
  public static getDefaultSearchPaths(cwd: string): Array<string> {
    return [
      join(cwd, ".open-codex", "skills"),
      join(cwd, ".kilocode", "skills"),
      join(cwd, ".opencode", "skills"),
      join(cwd, "skills"),
      join(homedir(), ".open-codex", "skills"),
      join(homedir(), ".kilocode", "skills"),
      join(homedir(), ".opencode", "skills"),
    ];
  }

  /**
   * Scan all search paths and load skills. First path wins on name collision.
   */
  public async loadSkills(): Promise<void> {
    const paths = this.searchPaths.length > 0
      ? this.searchPaths
      : SkillManager.getDefaultSearchPaths(process.cwd());

    for (const dir of paths) {
      if (!existsSync(dir)) continue;
      await this.scanDir(dir);
    }

    log(`Skills loaded: ${this.skills.size} from ${paths.length} search paths`);
  }

  private async scanDir(dir: string): Promise<void> {
    try {
      const files = readdirSync(dir).filter((f) =>
        f.endsWith(".js") || f.endsWith(".ts"),
      );
      for (const file of files) {
        const skillName = file.replace(/\.(js|ts)$/, "");
        if (this.skills.has(skillName)) {
          log(`Skill ${skillName} skipped (already loaded from ${this.skills.get(skillName)!.origin})`);
          continue;
        }
        const filePath = join(dir, file);
        try {
          const fileUrl = pathToFileURL(filePath).href;
          const module = await import(fileUrl);

          if (!module.default) {
            log(`Skipping skill ${file}: no default export`);
            continue;
          }

          let tools: Array<PluginTool> = [];
          let dispose: (() => Promise<void> | void) | undefined;
          let manifest: SkillManifest = {
            name: skillName,
            enabled: true,
          };

          if (typeof module.default === "function") {
            const result = (await module.default({}, {})) as any;
            if (result.tool) {
              tools = Array.isArray(result.tool)
                ? result.tool
                : Object.values(result.tool);
            }
            dispose = result.dispose;
            if (result["experimental.chat.system.transform"]) {
              this.pluginManager.registerSystemTransform(result["experimental.chat.system.transform"]);
            }
          } else if (module.default) {
            const raw = module.default as any;
            if (raw.tools) {
              tools = Array.isArray(raw.tools) ? raw.tools : Object.values(raw.tools);
            }
            if (raw.manifest) {
              manifest = { ...manifest, ...raw.manifest };
            }
            dispose = raw.dispose;
          }

          if (tools.length === 0) {
            log(`Skipping skill ${file}: no tools found`);
            continue;
          }

          this.skills.set(skillName, {
            manifest,
            path: filePath,
            origin: dir,
            tools,
            dispose,
          });

          for (const tool of tools) {
            const name =
              (tool.definition as any).function?.name || (tool.definition as any).name;
            if (name) {
              this.pluginManager.registerTool(name, tool);
            }
          }

          log(`Loaded skill: ${skillName} from ${dir}`);
        } catch (e) {
          log(`Error loading skill ${file}: ${e}`);
        }
      }
    } catch (e) {
      log(`Error reading skills directory ${dir}: ${e}`);
    }
  }

  public getSkills(): Array<LoadedSkill> {
    return Array.from(this.skills.values());
  }

  public getSkill(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  public async disposeAll(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.skills.values()).map(async (skill) => {
        if (skill.dispose) {
          try {
            await skill.dispose();
          } catch (e) {
            log(`Skill ${skill.manifest.name} dispose error: ${e}`);
          }
        }
      }),
    );
    this.skills.clear();
  }
}
