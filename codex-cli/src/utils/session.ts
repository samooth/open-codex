import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getVersion(): string {
  try {
    // Try to find package.json by walking up from current file
    let currentDir = __dirname;
    while (currentDir !== "/" && currentDir !== ".") {
      const pkgPath = join(currentDir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.version) return pkg.version;
      } catch {
        // continue walking up
      }
      const parent = dirname(currentDir);
      if (parent === currentDir) break;
      currentDir = parent;
    }
  } catch {
    // fallback
  }
  return "0.0.0";
}

export const CLI_VERSION = getVersion();
export const ORIGIN = "codex_cli_ts";

export type TerminalChatSession = {
  /** Globally unique session identifier */
  id: string;
  /** The OpenAI username associated with this session */
  user: string;
  /** Version identifier of the Codex CLI that produced the session */
  version: string;
  /** The model used for the conversation */
  model: string;
  /** ISO timestamp noting when the session was persisted */
  timestamp: string;
  /** Optional custom instructions that were active for the run */
  instructions: string;
};

let sessionId = "";

/**
 * Update the globally tracked session identifier.
 * Passing an empty string clears the current session.
 */
export function setSessionId(id: string): void {
  sessionId = id;
}

/**
 * Retrieve the currently active session identifier, or an empty string when
 * no session is active.
 */
export function getSessionId(): string {
  return sessionId;
}

let currentModel = "";

/**
 * Record the model that is currently being used for the conversation.
 * Setting an empty string clears the record so the next agent run can update it.
 */
export function setCurrentModel(model: string): void {
  currentModel = model;
}

/**
 * Return the model that was last supplied to {@link setCurrentModel}.
 * If no model has been recorded yet, an empty string is returned.
 */
export function getCurrentModel(): string {
  return currentModel;
}