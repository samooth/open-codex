import { execSync } from "child_process";
import { readdirSync, existsSync, appendFileSync } from "fs";
import { join, relative } from "path";
import { getIgnoreFilter } from "./agent/ignore-utils.js";

/**
 * Lists all files in the repository, respecting .gitignore if possible.
 */
export function listAllFiles(cwd: string = process.cwd()): string[] {
  // 1. Try git ls-files first
  try {
    const output = execSync("git ls-files", { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split("\n").filter(Boolean);
  } catch (err) {
    // 2. Fallback to manual recursive listing
    try {
      const ig = getIgnoreFilter();
      const files: string[] = [];

      function recurse(dir: string) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dir, entry.name);
          const relPath = relative(cwd, fullPath).replace(/\\/g, "/");
          
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          if (ig.ignores(relPath)) continue;

          if (entry.isDirectory()) {
            recurse(fullPath);
          } else {
            files.push(relPath);
          }
        }
      }

      recurse(cwd);
      return files;
    } catch {
      return [];
    }
  }
}
