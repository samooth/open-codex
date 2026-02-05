/* eslint-disable no-console */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { loadInstructions } from "../config";
import { getSessionId, setSessionId, getCurrentModel } from "../session";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { log, isLoggingEnabled } from "../agent/log.js";

const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");

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
  const firstUserMsg = items.find(i => i.role === "user");
  let summary = "";
  if (firstUserMsg) {
    const content = typeof firstUserMsg.content === "string" 
      ? firstUserMsg.content 
      : Array.isArray(firstUserMsg.content) 
        ? firstUserMsg.content.find(c => c.type === "text")?.text || ""
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
  } catch (error) {
    console.error(`Failed to save rollout to ${filePath}: `, error);
  }
}

let debounceTimer: NodeJS.Timeout | null = null;
let pendingItems: Array<ChatCompletionMessageParam> | null = null;

export async function loadRollouts(): Promise<Array<{ path: string; session: any }>> {
  try {
    if (!(await fs.stat(SESSIONS_ROOT).catch(() => null))) {
      return [];
    }
    const files = await fs.readdir(SESSIONS_ROOT);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    
    const rollouts: any[] = [];
    for (const f of jsonFiles) {
      const filePath = path.join(SESSIONS_ROOT, f);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        if (content.length < 10) continue;
        const data = JSON.parse(content);
        if (data.session) {
          // We intentionally don't return data.items here to save memory
          rollouts.push({ path: filePath, session: data.session });
        }
      } catch (err) {
        if (isLoggingEnabled()) {
          log(`Failed to load rollout metadata from ${filePath}: ${err}`);
        }
      }
    }

    return rollouts
      .sort((a, b) => {
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

export async function loadRollout(filePath: string): Promise<{ session: any; items: Array<ChatCompletionMessageParam> } | null> {
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
