import { test, expect, vi } from "vitest";
import { handleExecCommand } from "../src/utils/agent/handle-exec-command";
import { AgentLoop } from "../src/utils/agent/agent-loop";
import { AutoApprovalMode } from "../src/utils/auto-approval-mode";
import { ReviewDecision } from "../src/utils/agent/review";

test("handleExecCommand returns dry run message when dryRun is enabled", async () => {
  const config = {
    dryRun: true,
    apiKey: "dummy-key",
  };
  const args = { cmd: ["ls", "-la"] };
  
  const result = await handleExecCommand(
    args as any,
    config as any,
    AutoApprovalMode.FULL_AUTO,
    async () => ({ review: ReviewDecision.YES })
  );

  expect(result.outputText).toContain("[Dry Run] Would execute: ls -la");
  expect(result.metadata.dry_run).toBe(true);
});

test("AgentLoop.handleWriteFile returns dry run message when dryRun is enabled", async () => {
  const config = {
    dryRun: true,
    apiKey: "dummy-key",
  };
  
  const agent = new AgentLoop({
    model: "test-model",
    config: config as any,
    instructions: "",
    approvalPolicy: AutoApprovalMode.FULL_AUTO,
    onItem: vi.fn(),
    onLoading: vi.fn(),
    onReset: vi.fn(),
    getCommandConfirmation: async () => ({ review: ReviewDecision.YES }),
  });

  // Accessing private method for testing
  const result = await (agent as any).handleWriteFile(JSON.stringify({
    path: "test.txt",
    content: "hello world"
  }));

  expect(result.outputText).toContain("[Dry Run] Would write 11 characters to test.txt");
  expect(result.metadata.dry_run).toBe(true);
});
