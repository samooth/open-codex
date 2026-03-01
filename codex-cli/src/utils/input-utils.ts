import type { AppConfig } from "./config.js";
import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";

import { spawnSync } from "child_process";
import { fileTypeFromBuffer } from "file-type";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import fs from "fs/promises";
import os from "os";
import path from "path";

export async function processInputVariables(text: string): Promise<string> {
  const regex = /\{\{(.+?)\}\}/g;
  let result = text;
  const matches = [...text.matchAll(regex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const key = match[1]?.trim();
    if (!key) {
      continue;
    }

    // 1. Check environment variables
    if (process.env[key]) {
      result = result.replace(fullMatch, process.env[key]!);
      continue;
    }

    // 2. Check local files
    const filePath = path.resolve(process.cwd(), key);
    if (existsSync(filePath)) {
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const entry = `--- Content from ${key} ---\n\n${content}\n--- End of Context from ${key} ---`;
        result = result.replace(fullMatch, entry);
      } catch (err) {
        // Fallback to original if reading fails
      }
    }
  }

  return result;
}

export function openExternalEditor(
  initialContent: string,
  config?: AppConfig,
): string {
  const editor =
    config?.editorCommand ||
    process.env["VISUAL"] ||
    process.env["EDITOR"] ||
    (process.platform === "win32" ? "notepad" : "vi");
  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `codex-prompt-${Date.now()}.md`);

  writeFileSync(tmpFilePath, initialContent, "utf8");

  const wasRaw = process.stdin.isRaw;
  if (wasRaw) {
    process.stdin.setRawMode(false);
  }
  process.stdin.pause();

  const result = spawnSync(editor, [tmpFilePath], {
    stdio: "inherit",
    shell: true,
  });

  process.stdin.resume();
  if (wasRaw) {
    process.stdin.setRawMode(true);
  }

  if (result.status === 0) {
    try {
      const content = readFileSync(tmpFilePath, "utf8");
      unlinkSync(tmpFilePath);
      return content.trim();
    } catch (err) {
      // On error, we'll fall through and return the original content
    }
  }

  // If editor failed or file read failed, clean up and return original content
  try {
    unlinkSync(tmpFilePath);
  } catch (e) {
    // Ignore errors on cleanup
  }
  return initialContent;
}

export async function createInputItem(
  text: string,
  images: Array<string>,
): Promise<ChatCompletionMessageParam> {
  const processedText = await processInputVariables(text);
  const content: Array<ChatCompletionContentPart> = [
    { type: "text", text: processedText },
  ];

  for (const filePath of images) {
    try {
      /* eslint-disable no-await-in-loop */
      const binary = await fs.readFile(filePath);
      const kind = await fileTypeFromBuffer(binary);
      /* eslint-enable no-await-in-loop */
      const encoded = binary.toString("base64");
      const mime = kind?.mime ?? "application/octet-stream";
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${encoded}`,
        },
      });
    } catch (err) {
      content.push({
        type: "text",
        text: `[missing image: ${path.basename(filePath)}]`,
      });
    }
  }
  const inputItem: ChatCompletionMessageParam = {
    role: "user",
    content,
  };
  return inputItem;
}
