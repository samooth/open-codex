import type { ExecInput, ExecResult } from "./sandbox/interface.js";
import type { SpawnOptions } from "child_process";

import { process_patch } from "./apply-patch.js";
import { SandboxType } from "./sandbox/interface.js";
import { execWithSeatbelt } from "./sandbox/macos-seatbelt.js";
import { exec as rawExec } from "./sandbox/raw-exec.js";
import { formatCommandForDisplay } from "../../format-command.js";
import fs from "fs";
import os from "os";
import { parse, quote } from "shell-quote";

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds

function requiresShell(cmd: Array<string>): boolean {
  // If the command is a single string, we use shell: true to let the shell
  // handle finding the executable.
  if (cmd.length === 1 && cmd[0] !== undefined) {
    return true;
  }

  // If any of the arguments are shell operators, we need a shell.
  return cmd.some((arg) => {
    const tokens = parse(arg);
    return tokens.some((token) => typeof token === "object" && "op" in token);
  });
}

/**
 * This function should never return a rejected promise: errors should be
 * mapped to a non-zero exit code and the error message should be in stderr.
 */
export function exec(
  { cmd, workdir, timeoutInMillis }: ExecInput,
  sandbox: SandboxType,
  abortSignal?: AbortSignal,
  onOutput?: (chunk: string) => void,
): Promise<ExecResult> {
  // This is a temporary measure to understand what are the common base commands
  // until we start persisting and uploading rollouts

  const execForSandbox =
    sandbox === SandboxType.MACOS_SEATBELT ? execWithSeatbelt : rawExec;

  const needsShell = requiresShell(cmd);
  const finalCmd = needsShell ? [quote(cmd)] : cmd;

  const opts: SpawnOptions = {
    timeout: timeoutInMillis || DEFAULT_TIMEOUT_MS,
    ...(needsShell ? { shell: true } : {}),
    ...(workdir ? { cwd: workdir } : {}),
  };
  const writableRoots = [process.cwd(), os.tmpdir()];
  return execForSandbox(finalCmd, opts, writableRoots, abortSignal, onOutput);
}

export function execApplyPatch(patchText: string): ExecResult {
  // This is a temporary measure to understand what are the common base commands
  // until we start persisting and uploading rollouts

  try {
    const result = process_patch(
      patchText,
      (p) => fs.readFileSync(p, "utf8"),
      (p, c) => fs.writeFileSync(p, c, "utf8"),
      (p) => fs.unlinkSync(p),
    );
    return {
      stdout: result,
      stderr: "",
      exitCode: 0,
    };
  } catch (error: unknown) {
    // @ts-expect-error error might not be an object or have a message property.
    const stderr = String(error.message ?? error);
    return {
      stdout: "",
      stderr: stderr,
      exitCode: 1,
    };
  }
}

export function getBaseCmd(cmd: Array<string>): string {
  const formattedCommand = formatCommandForDisplay(cmd);
  return formattedCommand.split(" ")[0] || cmd[0] || "<unknown>";
}
