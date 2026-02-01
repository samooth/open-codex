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
  // On Windows, we almost always want a shell to handle .cmd/.bat files
  // and built-ins correctly.
  if (process.platform === "win32") {
    return true;
  }

  // If the command is a single string, we use shell: true to let the shell
  // handle finding the executable and parsing any complex syntax (pipes, etc.)
  if (cmd.length === 1 && cmd[0] !== undefined) {
    return true;
  }

  // If any of the arguments look like shell operators or variables, we need a shell.
  return cmd.some((arg) => {
    // Check for common shell characters that indicate we need a shell if not already length 1
    if (/[|&><$*;]/.test(arg)) {
      return true;
    }
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
  
  let finalCmd = cmd;
  if (needsShell) {
    if (process.platform === "win32") {
      // On Windows, we avoid shell-quote's quote() because it produces POSIX-style
      // quotes (single quotes) which cmd.exe does not understand.
      // If we have multiple arguments and need a shell, we pass them as an array
      // to spawn({shell: true}) and let Node.js handle the Windows-specific quoting.
      finalCmd = cmd;
    } else {
      // On POSIX, we use quote() to safely join multiple arguments into a single
      // string for the shell.
      if (cmd.length > 1) {
        finalCmd = [quote(cmd)];
      }
    }
  }

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
