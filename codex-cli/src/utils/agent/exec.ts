import type { ExecInput, ExecResult } from "./sandbox/interface.js";
import type { SpawnOptions } from "child_process";

import { process_patch } from "./apply-patch.js";
import { parseApplyPatch, PATCH_PREFIX, PATCH_SUFFIX, ADD_FILE_PREFIX, DELETE_FILE_PREFIX, UPDATE_FILE_PREFIX, END_OF_FILE_PREFIX } from "../../parse-apply-patch.js";
import { SandboxType } from "./sandbox/interface.js";
import { execWithSeatbelt } from "./sandbox/macos-seatbelt.js";
import { exec as rawExec } from "./sandbox/raw-exec.js";
import { formatCommandForDisplay } from "../../format-command.js";
import fs from "fs";
import os from "os";
import { parse, quote } from "shell-quote";

const DEFAULT_TIMEOUT_MS = 10_000; // 10 seconds

export function requiresShell(cmd: Array<string>): boolean {
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

export function execApplyPatch(patchText: string, excludedHunks?: Record<string, number[]>): ExecResult {
  // If we have exclusions, we need to rebuild the patch text without those hunks
  let finalPatchText = patchText;
  if (excludedHunks && Object.keys(excludedHunks).length > 0) {
    const ops = parseApplyPatch(patchText);
    if (!ops) {
      return { stdout: "", stderr: "Failed to parse patch for hunk exclusion", exitCode: 1 };
    }

    let rebuiltPatch = PATCH_PREFIX;
    let includedAny = false;

    for (const op of ops) {
      const excluded = excludedHunks[op.path] || [];
      
      // If all hunks of this op are excluded, skip the whole op
      if (op.type !== "delete" && op.hunks.length > 0 && excluded.length === op.hunks.length) {
        continue;
      }
      
      // Also allow excluding delete ops if path matches and excluded is [0] (dummy index)
      if (op.type === "delete" && excluded.length > 0) {
        continue;
      }

      includedAny = true;
      if (op.type === "create") {
        rebuiltPatch += `${ADD_FILE_PREFIX}${op.path}\n`;
        // For creations, usually we just have content, but if we have hunks we filter them
        if (op.hunks.length > 0) {
          for (let i = 0; i < op.hunks.length; i++) {
            if (!excluded.includes(i)) {
              rebuiltPatch += `${op.hunks[i]!.header}\n${op.hunks[i]!.lines.join("\n")}\n`;
            }
          }
        } else {
          rebuiltPatch += `${op.content}\n`;
        }
        rebuiltPatch += `${END_OF_FILE_PREFIX}\n`;
      } else if (op.type === "delete") {
        rebuiltPatch += `${DELETE_FILE_PREFIX}${op.path}\n`;
      } else if (op.type === "update") {
        rebuiltPatch += `${UPDATE_FILE_PREFIX}${op.path}\n`;
        for (let i = 0; i < op.hunks.length; i++) {
          if (!excluded.includes(i)) {
            rebuiltPatch += `${op.hunks[i]!.header}\n${op.hunks[i]!.lines.join("\n")}\n`;
          }
        }
      }
    }

    if (!includedAny) {
      return {
        stdout: "All patch hunks were excluded by user. Nothing to apply.",
        stderr: "",
        exitCode: 0,
      };
    }

    rebuiltPatch = rebuiltPatch.trim() + PATCH_SUFFIX;
    finalPatchText = rebuiltPatch;
  }

  try {
    const result = process_patch(
      finalPatchText,
      (p) => fs.readFileSync(p, "utf8"),
      (p, c) => fs.writeFileSync(p, c, "utf8"),
      (p) => fs.unlinkSync(p),
    );
    return {
      stdout: result.message,
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
