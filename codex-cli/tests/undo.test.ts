import { describe, it, expect, vi, beforeEach } from "vitest";
import { undoLastChange } from "../src/utils/storage/save-rollout.js";
import fs from "fs/promises";
import path from "path";
import os from "os";

vi.mock("fs/promises");

describe("Undo Logic", () => {
  const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
  const writeFn = vi.fn();
  const removeFn = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores files from backups and truncates history", async () => {
    const sessionId = "test-session";
    const sessionFile = path.join(SESSIONS_ROOT, `session-${sessionId}.json`);

    // Mock a session history:
    // 1. User: "change file"
    // 2. Assistant: (tool call with backup)
    // 3. Tool Output: "success"
    const mockData = {
      session: { id: sessionId },
      items: [
        { role: "user", content: "initial prompt" }, // index 0
        { role: "assistant", content: "ok" }, // index 1
        { role: "user", content: "change file" }, // index 2 (UNDO TARGET)
        {
          role: "assistant",
          tool_calls: [
            { id: "call1", function: { name: "write_file", arguments: "{}" } },
          ],
        },
        {
          role: "tool",
          content: JSON.stringify({
            output: "done",
            metadata: {
              backups: {
                "file.txt": "original content",
                "new_file.txt": null, // was created, so null means remove it
              },
            },
          }),
        },
      ],
    };

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

    const result = await undoLastChange(sessionId, writeFn, removeFn);

    expect(result.success).toBe(true);
    expect(result.message).toContain("2 file(s) restored");

    // Check file restoration
    expect(writeFn).toHaveBeenCalledWith("file.txt", "original content");
    expect(removeFn).toHaveBeenCalledWith("new_file.txt");

    // Check history truncation
    // Should keep items up to index 2 (exclusive), so only 0 and 1
    expect(result.items.length).toBe(2);
    expect(result.items[0]?.content).toBe("initial prompt");
    expect(result.items[1]?.content).toBe("ok");

    // Verify save
    expect(fs.writeFile).toHaveBeenCalledWith(
      sessionFile,
      expect.stringContaining('"items":'), // Simplified check
      "utf-8",
    );
  });

  it("handles undo when no user turn is found", async () => {
    const sessionId = "empty-session";
    const mockData = {
      session: { id: sessionId },
      items: [{ role: "system", content: "you are a bot" }],
    };

    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockData));

    const result = await undoLastChange(sessionId, writeFn, removeFn);

    expect(result.success).toBe(false);
    expect(result.message).toContain("No user interaction found");
    expect(writeFn).not.toHaveBeenCalled();
  });
});
