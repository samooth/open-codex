import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs/promises";
import path from "path";
import os from "os";
import { renameSession } from "../src/utils/storage/save-rollout.js";

vi.mock("fs/promises");

describe("Session Storage Logic", () => {
  const SESSIONS_ROOT = path.join(os.homedir(), ".codex", "sessions");
  const SESSIONS_INDEX = path.join(os.homedir(), ".codex", "sessions.json");

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames a session and updates the index", async () => {
    const sessionId = "test-id-123";
    const oldSummary = "Old Summary";
    const newSummary = "New Awesome Summary";
    const sessionFile = path.join(SESSIONS_ROOT, `session-${sessionId}.json`);

    const mockSessionData = {
      session: {
        id: sessionId,
        summary: oldSummary,
        timestamp: "2026-02-10T23:02:34.511Z",
      },
      items: [],
    };

    const mockIndexData = [{ id: sessionId, summary: oldSummary }];

    // Mock reading the session file
    vi.mocked(fs.readFile).mockImplementation((p) => {
      if (p === sessionFile) {
        return Promise.resolve(JSON.stringify(mockSessionData));
      }
      if (p === SESSIONS_INDEX) {
        return Promise.resolve(JSON.stringify(mockIndexData));
      }
      return Promise.reject(new Error("File not found"));
    });

    await renameSession(sessionId, newSummary);

    // Verify session file was updated
    expect(fs.writeFile).toHaveBeenCalledWith(
      sessionFile,
      expect.stringContaining(newSummary),
      "utf-8",
    );

    // Verify index was updated
    expect(fs.writeFile).toHaveBeenCalledWith(
      SESSIONS_INDEX,
      expect.stringContaining(newSummary),
      "utf-8",
    );

    // Check that it contains the new summary in the JSON
    const indexWriteCall = vi
      .mocked(fs.writeFile)
      .mock.calls.find((call) => call[0] === SESSIONS_INDEX);
    const writtenIndex = JSON.parse(indexWriteCall![1] as string);
    expect(writtenIndex[0].summary).toBe(newSummary);
  });
});
