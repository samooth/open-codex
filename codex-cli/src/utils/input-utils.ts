import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";

import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { spawn } from "child_process";
import os from "os";
import type { AppConfig } from "./config.js";

export async function processInputVariables(text: string): Promise<string> {
  const regex = /\{\{(.+?)\}\}/g;
  let result = text;
  const matches = [...text.matchAll(regex)];

  for (const match of matches) {
    const fullMatch = match[0];
    const key = match[1]?.trim();
    if (!key) continue;

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

export async function openExternalEditor(initialContent: string, config?: AppConfig): Promise<string> {
  const editor = config?.editorCommand || process.env["VISUAL"] || process.env["EDITOR"] || (process.platform === "win32" ? "notepad" : "vi");
  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `codex-prompt-${Date.now()}.md`);

  await fs.writeFile(tmpFilePath, initialContent, "utf8");

  const wasRaw = process.stdin.isRaw;

  return new Promise((resolve, reject) => {
    if (wasRaw) {
      process.stdin.setRawMode(false);
    }

    const child = spawn(editor, [tmpFilePath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", async (code) => {
      if (wasRaw) {
        process.stdin.setRawMode(true);
      }

      if (code === 0) {
        try {
          const content = await fs.readFile(tmpFilePath, "utf8");
          await fs.unlink(tmpFilePath).catch(() => {});
          resolve(content.trim());
        } catch (err) {
          reject(err);
        }
      } else {
        await fs.unlink(tmpFilePath).catch(() => {});
        resolve(initialContent); // Fallback to original content if editor failed
      }
    });

    child.on("error", (err) => {
      if (wasRaw) {
        process.stdin.setRawMode(true);
      }
      reject(err);
    });
  });
}

export async function createInputItem(
  text: string,
  images: Array<string>,
): Promise<ChatCompletionMessageParam> {
  const processedText = await processInputVariables(text);
  const content: Array<ChatCompletionContentPart> = [{ type: "text", text: processedText }];

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
