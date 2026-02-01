import { existsSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import ignore from "ignore";

/**
 * Searches for the Git root starting from the current directory.
 */
function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

const DEFAULT_IGNORE_PATTERNS = [
  // Git
  ".git",
  // Node.js
  "node_modules",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  ".npm",
  // IDEs
  ".vscode",
  ".idea",
  ".DS_Store",
  "Thumbs.db",
  // Build artifacts
  "dist",
  "build",
  "out",
  ".next",
  // Python
  "__pycache__",
  "*.pyc",
  "venv",
  ".venv",
  // OpenCodex internal
  ".codex",
];

/**
 * Loads ignore patterns from .codexignore and .gitignore files.
 */
export function getIgnoreFilter() {
  const ig = ignore().add(DEFAULT_IGNORE_PATTERNS);
  
  const cwd = process.cwd();
  const gitRoot = findGitRoot(cwd);
  
  const searchDirs = [cwd];
  if (gitRoot && gitRoot !== cwd) {
    searchDirs.push(gitRoot);
  }
  
  // Also check home directory for global ignore
  searchDirs.push(join(homedir(), ".codex"));

  for (const dir of searchDirs) {
    const codexIgnorePath = join(dir, ".codexignore");
    if (existsSync(codexIgnorePath)) {
      try {
        ig.add(readFileSync(codexIgnorePath, "utf-8"));
      } catch { /* ignore */ }
    }
    
    const gitIgnorePath = join(dir, ".gitignore");
    if (existsSync(gitIgnorePath)) {
      try {
        ig.add(readFileSync(gitIgnorePath, "utf-8"));
      } catch { /* ignore */ }
    }
  }

  return ig;
}

/**
 * Checks if a given path should be ignored.
 * @param filePath The path to check (relative to process.cwd() or absolute).
 */
export function isPathIgnored(filePath: string): boolean {
  const ig = getIgnoreFilter();
  const relativePath = filePath.startsWith(process.cwd()) 
    ? filePath.slice(process.cwd().length + 1) 
    : filePath;
    
  if (!relativePath) return false;
  
  return ig.ignores(relativePath);
}
