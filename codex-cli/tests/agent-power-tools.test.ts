import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyEdits } from "../src/utils/agent/edit-file.js";
import { extractSymbols } from "../src/utils/agent/symbol-extractor.js";
import { runProjectDiagnostics } from "../src/utils/agent/diagnostics.js";
import { createCheckpoint } from "../src/utils/agent/checkpoint.js";
import { handleUpdateTasks } from "../src/utils/agent/tool-handlers.js";
import * as execHandlers from "../src/utils/agent/handle-exec-command.js";
import fs from "fs";

vi.mock("fs");
vi.mock("../src/utils/agent/handle-exec-command.js");

describe("Agent Power Tools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "cwd").mockReturnValue("/mock/root");
  });

  describe("edit_file (applyEdits)", () => {
    it("successfully applies an exact match edit", () => {
      const originalContent = "line 1\nline 2\nline 3";
      vi.mocked(fs.readFileSync).mockReturnValue(originalContent);

      const edits = [{ search: "line 2", replace: "line TWO" }];
      const result = applyEdits("test.txt", edits);

      expect(result.success).toBe(true);
      expect(result.content).toBe("line 1\nline TWO\nline 3");
    });
  });

  describe("read_symbols (extractSymbols)", () => {
    it("extracts classes and functions from TypeScript", () => {
      const code = "export class User { constructor() {} }\nfunction login(u: User) {}\ninterface Session {}";
      vi.mocked(fs.readFileSync).mockReturnValue(code);

      const result = extractSymbols("user.ts");
      expect(result).toContain("class      User");
      expect(result).toContain("function   login");
    });
  });

  describe("run_diagnostics", () => {
    it("detects Node.js project and runs scripts", async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: any) => path.endsWith("package.json"));
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        scripts: { typecheck: "tsc", test: "mocha" }
      }));

      vi.mocked(execHandlers.handleExecCommand).mockResolvedValue({
        outputText: "passed",
        metadata: { exit_code: 0 }
      });

      const ctx: any = { config: {}, approvalPolicy: "suggest" };
      const result = await runProjectDiagnostics(ctx);

      expect(result.success).toBe(true);
      expect(result.projectType).toBe("Node.js/TypeScript");
      
      expect(execHandlers.handleExecCommand).toHaveBeenCalledWith(
        expect.objectContaining({ cmd: ["npm", "run", "typecheck"] }),
        ctx.config,
        ctx.approvalPolicy,
        ctx.getCommandConfirmation,
        undefined
      );
    });
  });

  describe("checkpoint", () => {
    it("successfully creates a git tag checkpoint", async () => {
      vi.mocked(execHandlers.handleExecCommand).mockResolvedValue({
        outputText: "",
        metadata: { exit_code: 0 }
      });

      const ctx: any = { config: {}, approvalPolicy: "suggest" };
      const result = await createCheckpoint(ctx, "test-feature");

      expect(result.success).toBe(true);
      expect(result.name).toContain("codex/checkpoint-");
      
      expect(execHandlers.handleExecCommand).toHaveBeenCalledWith(
        expect.objectContaining({ cmd: expect.arrayContaining(["git", "tag"]) }),
        ctx.config,
        ctx.approvalPolicy,
        ctx.getCommandConfirmation,
        undefined
      );
    });
  });

  describe("update_tasks", () => {
    it("triggers onTasksUpdate callback with provided tasks", async () => {
      const onTasksUpdate = vi.fn();
      const ctx: any = { onTasksUpdate };
      const tasks = [
        { label: "Step 1", status: "done" },
        { label: "Step 2", status: "in-progress" }
      ];
      
      const result = await handleUpdateTasks(ctx, JSON.stringify({ tasks }));

      expect(result.metadata["exit_code"]).toBe(0);
      expect(onTasksUpdate).toHaveBeenCalledWith(tasks);
    });

    it("sanitizes malformed task labels", async () => {
      const onTasksUpdate = vi.fn();
      const ctx: any = { onTasksUpdate };
      const tasks = [
        { label: { complex: "object" }, status: "done" }
      ];
      
      const result = await handleUpdateTasks(ctx, JSON.stringify({ tasks }));

      expect(result.metadata["exit_code"]).toBe(0);
      expect(onTasksUpdate).toHaveBeenCalledWith([
        { label: '{"complex":"object"}', status: "done" }
      ]);
    });

    it("fails if tasks array is missing", async () => {
      const ctx: any = {};
      const result = await handleUpdateTasks(ctx, "{}");

      expect(result.metadata["exit_code"]).toBe(1);
      expect(result.outputText).toContain("tasks' array is required");
    });
  });
});
