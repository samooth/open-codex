import { test, expect, vi } from "vitest";
import { handleExecCommand } from "../src/utils/agent/handle-exec-command";
import { handleWriteFile } from "../src/utils/agent/tool-handlers";
import { AutoApprovalMode } from "../src/utils/auto-approval-mode";
import { ReviewDecision } from "../src/utils/agent/review";
import type { AgentContext } from "../src/utils/agent/types";

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

test("handleWriteFile returns dry run message when dryRun is enabled", async () => {
  const config = {
    dryRun: true,
    apiKey: "dummy-key",
  };
  
  const ctx: AgentContext = {
    config: config as any,
    approvalPolicy: AutoApprovalMode.FULL_AUTO,
    execAbortController: new AbortController(),
    getCommandConfirmation: async () => ({ review: ReviewDecision.YES }),
    onItem: vi.fn(),
  };

  const result = await handleWriteFile(ctx, JSON.stringify({
    path: "test.txt",
    content: "hello world"
  }));

  expect(result.outputText).toContain("[Dry Run] Would write 11 characters to test.txt");
  expect(result.metadata.dry_run).toBe(true);
});
