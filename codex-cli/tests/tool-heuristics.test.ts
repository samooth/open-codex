import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSearchCodebase, handleReadFileLines } from "../src/utils/agent/tool-handlers.js";
import { handleExecCommand } from "../src/utils/agent/handle-exec-command.js";

vi.mock("../src/utils/agent/handle-exec-command.js");
vi.mock("../src/utils/agent/ignore-utils.js", () => ({
  getIgnoreFilter: () => ({ ignores: () => false })
}));

describe("Tool Argument Heuristics", () => {
  const mockCtx = {
    config: {},
    approvalPolicy: "auto",
    getCommandConfirmation: vi.fn(),
    execAbortController: { signal: {} },
    agent: { hasIndex: () => false }
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("handleSearchCodebase Heuristics", () => {
    it("corrects swapped pattern and query when pattern is a glob", async () => {
      // Input has query="search term" and pattern="*.ts"
      // Heuristic should move "*.ts" to include and query to pattern
      const rawArgs = JSON.stringify({
        query: "important function",
        pattern: "*.ts"
      });

      (handleExecCommand as any).mockResolvedValue({
        outputText: "match",
        metadata: { exit_code: 0 }
      });

      await handleSearchCodebase(mockCtx, rawArgs);

      const execCall = vi.mocked(handleExecCommand).mock.calls[0];
      const cmd = execCall![0].cmd;
      
      // Expected rg command: rg --json "important function" -g "*.ts"
      expect(cmd).toContain("important function");
      expect(cmd).toContain("-g");
      expect(cmd).toContain("*.ts");
    });

    it("uses query as fallback when pattern is missing", async () => {
      const rawArgs = JSON.stringify({
        query: "fallback search"
      });

      (handleExecCommand as any).mockResolvedValue({
        outputText: "match",
        metadata: { exit_code: 0 }
      });

      await handleSearchCodebase(mockCtx, rawArgs);

      const execCall = vi.mocked(handleExecCommand).mock.calls[0];
      const cmd = execCall![0].cmd;
      expect(cmd).toContain("fallback search");
    });
  });

  describe("handleReadFileLines Heuristics", () => {
    it("supports 'start' and 'end' aliases", async () => {
      const rawArgs = JSON.stringify({
        path: "test.ts",
        start: 10,
        end: 20
      });

      // Mock fs readFileSync indirectly via tool logic or just check args passed to exec
      // Since handleReadFileLines uses readFileSync internally after an exec check,
      // we just want to ensure it didn't return the "missing params" error.
      
      (handleExecCommand as any).mockResolvedValue({
        outputText: "ok",
        metadata: { exit_code: 0 }
      });

      // We expect this to fail later because the file doesn't exist, 
      // but if the heuristic works, it won't fail the initial validation.
      const result = await handleReadFileLines(mockCtx, rawArgs);
      
      expect(result.outputText).not.toContain("required");
    });

    it("supports 'line_start' and 'line_end' aliases", async () => {
      const rawArgs = JSON.stringify({
        path: "test.ts",
        line_start: 5,
        line_end: 15
      });

      (handleExecCommand as any).mockResolvedValue({
        outputText: "ok",
        metadata: { exit_code: 0 }
      });

      const result = await handleReadFileLines(mockCtx, rawArgs);
      expect(result.outputText).not.toContain("required");
    });
  });
});
