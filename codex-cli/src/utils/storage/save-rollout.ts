/* eslint-disable no-console */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { log, isLoggingEnabled } from "../agent/log.js";
import { loadInstructions } from "../config";
import { getSessionId, setSessionId, getCurrentModel } from "../session";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";

const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
const SESSIONS_INDEX = path.join(os.homedir(), ".codex", "sessions.json");

async function saveRolloutToHomeSessions(
  items: Array<ChatCompletionMessageParam>,
): Promise<void> {
  await fs.mkdir(SESSIONS_ROOT, { recursive: true });

  let sessionId = getSessionId();
  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSessionId(sessionId);
  }

  const timestamp = new Date().toISOString();
  // We use a fixed filename for the session to overwrite it with updates
  const filename = `session-${sessionId}.json`;
  const filePath = path.join(SESSIONS_ROOT, filename);
  const instructions = loadInstructions();
  const model = getCurrentModel();

  // Extract a summary from the first user prompt
  const firstUserMsg = items.find((i) => i.role === "user");
  let summary = "";
  if (firstUserMsg) {
    const content =
      typeof firstUserMsg.content === "string"
        ? firstUserMsg.content
        : Array.isArray(firstUserMsg.content)
          ? firstUserMsg.content.find((c) => c.type === "text")?.text || ""
          : "";
    summary = content.slice(0, 100);
  }

  try {
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          session: {
            timestamp,
            id: sessionId,
            instructions,
            model,
            summary,
          },
          items,
        },
        null,
        2,
      ),
      "utf8",
    );
    await updateSessionsIndex({
      timestamp,
      id: sessionId,
      model,
      summary,
      instructions,
    });
  } catch (error) {
    console.error(`Failed to save rollout to ${filePath}: `, error);
  }
}

let debounceTimer: NodeJS.Timeout | null = null;
let pendingItems: Array<ChatCompletionMessageParam> | null = null;

export async function loadRollouts(): Promise<
  Array<{ path: string; session: any }>
> {
  try {
    if (!(await fs.stat(SESSIONS_ROOT).catch(() => null))) {
      return [];
    }

    // Fast path: load from index if it exists
    const indexContent = await fs
      .readFile(SESSIONS_INDEX, "utf-8")
      .catch(() => null);
    if (indexContent) {
      const index = JSON.parse(indexContent);
      return index
        .map((session: any) => ({
          path: path.join(SESSIONS_ROOT, `session-${session.id}.json`),
          session,
        }))
        .sort((a: any, b: any) => {
          const tA = new Date(a.session?.timestamp || 0).getTime();
          const tB = new Date(b.session?.timestamp || 0).getTime();
          return tB - tA;
        });
    }

    // Slow path: build index from scratch
    const files = await fs.readdir(SESSIONS_ROOT);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    const rollouts: Array<any> = [];
    for (const f of jsonFiles) {
      const filePath = path.join(SESSIONS_ROOT, f);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        if (content.length < 10) {
          continue;
        }
        const data = JSON.parse(content);
        if (data.session) {
          rollouts.push({ path: filePath, session: data.session });
        }
      } catch (err) {
        if (isLoggingEnabled()) {
          log(`Failed to load rollout metadata from ${filePath}: ${err}`);
        }
      }
    }

    // Save the newly built index for next time
    await fs.writeFile(
      SESSIONS_INDEX,
      JSON.stringify(rollouts.map((r) => r.session)),
      "utf-8",
    );

    return rollouts.sort((a: any, b: any) => {
      const tA = new Date(a.session?.timestamp || 0).getTime();
      const tB = new Date(b.session?.timestamp || 0).getTime();
      return tB - tA;
    });
  } catch (err) {
    if (isLoggingEnabled()) {
      log(`Error in loadRollouts: ${err}`);
    }
    return [];
  }
}

async function updateSessionsIndex(newSession: any) {
  let index = [];
  try {
    const content = await fs.readFile(SESSIONS_INDEX, "utf-8");
    index = JSON.parse(content);
  } catch (error) {
    // Index doesn't exist or is invalid, will be created
  }

  const existingIndex = index.findIndex((s: any) => s.id === newSession.id);
  if (existingIndex !== -1) {
    // Update existing session
    const existing = index[existingIndex];
    index[existingIndex] = {
      ...existing,
      ...newSession,
    };
  } else {
    // Add new session
    index.push(newSession);
  }

  // Keep the index from growing indefinitely, cap at 500
  if (index.length > 500) {
    index = index.slice(index.length - 500);
  }

  await fs.writeFile(SESSIONS_INDEX, JSON.stringify(index, null, 2), "utf-8");
}

export async function renameSession(
  id: string,
  newSummary: string,
): Promise<void> {
  const filePath = path.join(SESSIONS_ROOT, `session-${id}.json`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    if (data.session) {
      data.session.summary = newSummary;
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

      // Update index as well
      await updateSessionsIndex(data.session);
    }
  } catch (err) {
    if (isLoggingEnabled()) {
      log(`Failed to rename session ${id}: ${err}`);
    }
    throw err;
  }
}

export async function undoLastChange(
  sessionId: string,
  writeFn: (p: string, c: string) => void,
  removeFn: (p: string) => void,
): Promise<{
  items: Array<ChatCompletionMessageParam>;
  success: boolean;
  message: string;
}> {
  const filePath = path.join(SESSIONS_ROOT, `session-${sessionId}.json`);
  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);
    const items = data.items as Array<ChatCompletionMessageParam>;

    if (items.length === 0) {
      return { items, success: false, message: "Nothing to undo." };
    }

    // Find the last turn (User prompt + Assistant response + optional Tool outputs)
    let lastUserIndex = -1;
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i]!.role === "user") {
        lastUserIndex = i;
        break;
      }
    }

    if (lastUserIndex === -1) {
      return {
        items,
        success: false,
        message: "No user interaction found to undo.",
      };
    }

    // Collect all backups from tool outputs in this turn
    const turnItems = items.slice(lastUserIndex);
    const backups: Record<string, string | null> = {};

    for (const item of turnItems) {
      if (item.role === "tool" && typeof item.content === "string") {
        try {
          const parsed = JSON.parse(item.content);
          if (parsed.metadata?.backups) {
            Object.assign(backups, parsed.metadata.backups);
          }
        } catch {
          /* ignore */
        }
      }
    }

    // Revert files
    for (const [path, content] of Object.entries(backups)) {
      if (content === null) {
        removeFn(path);
      } else {
        writeFn(path, content);
      }
    }

    // Remove the turn from history
    const remainingItems = items.slice(0, lastUserIndex);
    data.items = remainingItems;
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");

    return {
      items: remainingItems,
      success: true,
      message: `Undone last turn. ${Object.keys(backups).length} file(s) restored.`,
    };
  } catch (err) {
    return { items: [], success: false, message: `Undo failed: ${err}` };
  }
}

export async function loadRollout(
  filePath: string,
): Promise<{ session: any; items: Array<ChatCompletionMessageParam> } | null> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    if (isLoggingEnabled()) {
      log(`Failed to load rollout detail from ${filePath}: ${err}`);
    }
    return null;
  }
}

export function saveRollout(items: Array<ChatCompletionMessageParam>): void {
  pendingItems = items;
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    if (pendingItems) {
      saveRolloutToHomeSessions(pendingItems).catch(() => {});
      pendingItems = null;
    }
    debounceTimer = null;
  }, 2000);
}

/**
 * Immediately save any pending rollout items.
 */
export async function flushRollout(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingItems) {
    await saveRolloutToHomeSessions(pendingItems);
    pendingItems = null;
  }
}
