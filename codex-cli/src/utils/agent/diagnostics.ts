import type { AgentContext } from "./types.js";

import { handleExecCommand } from "./handle-exec-command.js";
import { existsSync, readFileSync } from "fs";

export interface DiagnosticResult {
  success: boolean;
  projectType: string;
  output: string;
}

export async function runProjectDiagnostics(ctx: AgentContext): Promise<DiagnosticResult> {
  const root = process.cwd();
  let projectType = "unknown";
  const commands: Array<Array<string>> = [];

  // 1. Detect Project Type and select commands
  if (existsSync(`${root}/package.json`)) {
    projectType = "Node.js/TypeScript";
    try {
      const pkg = JSON.parse(readFileSync(`${root}/package.json`, "utf-8"));
      const scripts = pkg.scripts || {};
      
      // Select best available commands
      if (scripts.typecheck) {commands.push(["npm", "run", "typecheck"]);}
      else if (scripts.build) {commands.push(["npm", "run", "build"]);}
      
      if (scripts.lint) {commands.push(["npm", "run", "lint"]);}
      
      if (scripts.test) {commands.push(["npm", "test"]);}
    } catch {
      commands.push(["npm", "test"]);
    }
  } else if (existsSync(`${root}/Cargo.toml`)) {
    projectType = "Rust";
    commands.push(["cargo", "check"]);
    commands.push(["cargo", "test"]);
  } else if (existsSync(`${root}/go.mod`)) {
    projectType = "Go";
    commands.push(["go", "build", "./..."]);
    commands.push(["go", "test", "./..."]);
  } else if (existsSync(`${root}/requirements.txt`) || existsSync(`${root}/pyproject.toml`)) {
    projectType = "Python";
    commands.push(["pytest"]); // Defaulting to pytest
  }

  if (commands.length === 0) {
    return {
      success: false,
      projectType,
      output: "No standard diagnostic commands detected for this project type."
    };
  }

  // 2. Run commands and accumulate output
  let combinedOutput = `Running diagnostics for ${projectType} project...\n\n`;
  let allPassed = true;

  for (const cmd of commands) {
    combinedOutput += `> ${cmd.join(" ")}\n`;
    const result = await handleExecCommand(
      { cmd, workdir: root, timeoutInMillis: 60000 },
      ctx.config,
      ctx.approvalPolicy,
      ctx.getCommandConfirmation,
      ctx.execAbortController?.signal
    );

    if (result.outputText === "aborted") {
      return { success: false, projectType, output: "Diagnostics aborted by user." };
    }

    combinedOutput += result.outputText + "\n";
    if (result.metadata["exit_code"] !== 0) {
      allPassed = false;
      combinedOutput += `❌ Command failed with exit code ${result.metadata["exit_code"]}\n`;
      break; // Stop at first failure to be concise
    } else {
      combinedOutput += `✅ Command passed.\n`;
    }
    combinedOutput += "-----------------------------------\n";
  }

  return {
    success: allPassed,
    projectType,
    output: combinedOutput.trim()
  };
}
