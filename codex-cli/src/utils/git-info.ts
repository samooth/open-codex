import { execSync } from "child_process";

export type GitInfo = {
  branch: string;
  dirty: boolean;
  lastCommit: string;
};

/**
 * Returns a small summary of the current git repository, or `null` when the
 * working directory is not inside a git work tree. All calls are wrapped so
 * that a missing git binary / non-git dir never throws.
 */
export function getGitInfo(workdir: string = process.cwd()): GitInfo | null {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      cwd: workdir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const status = execSync("git status --porcelain", {
      cwd: workdir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const lastCommit = execSync("git log -1 --pretty=%s", {
      cwd: workdir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (!branch) {
      return null;
    }

    return {
      branch,
      dirty: status.length > 0,
      lastCommit,
    };
  } catch {
    return null;
  }
}