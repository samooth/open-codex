import type {
  ChatCompletionContentPart,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions.mjs";

import { fileTypeFromBuffer } from "file-type";
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import os from "os";

export async function openExternalEditor(initialContent: string): Promise<string> {
  const editor = process.env["EDITOR"] || (process.platform === "win32" ? "notepad" : "vi");
  const tmpDir = os.tmpdir();
  const tmpFilePath = path.join(tmpDir, `codex-prompt-${Date.now()}.md`);

  await fs.writeFile(tmpFilePath, initialContent, "utf8");

  return new Promise((resolve, reject) => {
    const child = spawn(editor, [tmpFilePath], {
      stdio: "inherit",
      shell: true,
    });

    child.on("exit", async (code) => {
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
      reject(err);
    });
  });
}

export async function createInputItem(
  text: string,
  images: Array<string>,
): Promise<ChatCompletionMessageParam> {
  const content: Array<ChatCompletionContentPart> = [{ type: "text", text }];

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
