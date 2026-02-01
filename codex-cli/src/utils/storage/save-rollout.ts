/* eslint-disable no-console */

import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { loadInstructions } from "../config";
import { getSessionId, setSessionId, getCurrentModel } from "../session";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";

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
    const rollouts = await Promise.all(
      files
        .filter((f) => f.endsWith(".json"))
        .map(async (f) => {
          const filePath = path.join(SESSIONS_ROOT, f);
          try {
            const content = await fs.readFile(filePath, "utf-8");
            const data = JSON.parse(content);
            return { path: filePath, session: data.session, items: data.items };
          } catch {
            return null;
          }
        }),
    );
    return rollouts
      .filter((r): r is any => r !== null)
      .sort((a, b) => new Date(b.session.timestamp).getTime() - new Date(a.session.timestamp).getTime());
  } catch {
    return [];
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
