import type { AgentContext } from "./types.js";

import { handleExecCommand } from "./handle-exec-command.js";

export interface CheckpointResult {
  success: boolean;
  name: string;
  output: string;
}

export async function createCheckpoint(ctx: AgentContext, name: string): Promise<CheckpointResult> {
  const root = process.cwd();
  // Sanitize name for git branch/tag
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  const checkpointName = `codex/checkpoint-${Date.now()}-${sanitizedName}`;

  // 1. Check if we are in a git repo
  const checkGit = await handleExecCommand(
    { cmd: ["git", "rev-parse", "--is-inside-work-tree"], workdir: root, timeoutInMillis: undefined },
    ctx.config,
    ctx.approvalPolicy,
    ctx.getCommandConfirmation,
    ctx.execAbortController?.signal
  );

  if (checkGit.metadata["exit_code"] !== 0) {
    return {
      success: false,
      name: "",
      output: "Cannot create checkpoint: Not a git repository."
    };
  }

  // 2. Create a temporary commit or tag to mark the state
  // We'll use a tag for simplicity as it doesn't move the HEAD or require a branch switch
  const tagCmd = ["git", "tag", "-a", checkpointName, "-m", `OpenCodex Checkpoint: ${name}`];
  
  const result = await handleExecCommand(
    { cmd: tagCmd, workdir: root, timeoutInMillis: undefined },
    ctx.config,
    ctx.approvalPolicy,
    ctx.getCommandConfirmation,
    ctx.execAbortController?.signal
  );

  if (result.metadata["exit_code"] === 0) {
    return {
      success: true,
      name: checkpointName,
      output: `Checkpoint '${checkpointName}' created successfully.`
    };
  } else {
    return {
      success: false,
      name: "",
      output: `Failed to create checkpoint: ${result.outputText}`
    };
  }
}
