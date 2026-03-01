/**
 * Provides actionable suggestions to the LLM based on tool failure output.
 * This helps the agent recover from common terminal errors by suggesting 
 * built-in tools or correct patterns.
 */
export function getActionableSuggestion(
  command: string[],
  exitCode: number,
  stdout: string,
  stderr: string
): string | undefined {
  if (exitCode === 0) return undefined;

  const fullOutput = (stdout + "\n" + stderr).toLowerCase();
  const cmdStr = command.join(" ").toLowerCase();

  // 1. Command not found
  if (fullOutput.includes("command not found") || fullOutput.includes("not recognized as an internal or external command")) {
    if (cmdStr.includes("grep")) {
      return "Suggestion: 'grep' might not be installed or in the PATH. Try using the built-in 'grep_search' tool which is faster and cross-platform.";
    }
    if (cmdStr.includes("find ")) {
      return "Suggestion: 'find' might not be available. Try using the built-in 'list_files_recursive' or 'glob' tools.";
    }
    if (cmdStr.includes("sed ") || cmdStr.includes("awk ")) {
      return "Suggestion: Complex stream editors like 'sed' or 'awk' are error-prone in this environment. Try using 'read_file' followed by 'write_file' or 'edit_file' to manipulate content programmatically.";
    }
    if (cmdStr.includes("curl ") || cmdStr.includes("wget ")) {
        return "Suggestion: Network tools might be blocked or missing. Try using the built-in 'web_fetch' or 'google_web_search' tools.";
    }
    return "Suggestion: The command was not found. Check if the tool is installed or try using a built-in alternative.";
  }

  // 2. Permission denied
  if (fullOutput.includes("permission denied") || fullOutput.includes("access is denied")) {
    if (cmdStr.includes(".git")) {
        return "Suggestion: Access to .git directory is restricted for safety. Use high-level git commands if necessary, or avoid touching .git directly.";
    }
    return "Suggestion: Permission denied. The sandbox might be restricting access to this path, or the file is read-only.";
  }

  // 3. No such file or directory
  if (fullOutput.includes("no such file or directory") || fullOutput.includes("cannot find the path")) {
    return "Suggestion: The path does not exist. Use 'list_directory' or 'list_files_recursive' to verify the current file structure before proceeding.";
  }

  // 4. Too many arguments / Input too long
  if (fullOutput.includes("argument list too long")) {
    return "Suggestion: The argument list is too long. Try processing files in smaller batches or using a glob pattern with a built-in tool.";
  }

  // 5. Generic failure with common tools
  if (cmdStr.startsWith("npm install") || cmdStr.startsWith("yarn add")) {
    return "Suggestion: Package installation failed. Check for network issues or conflicting dependencies. You can try running it again or asking the user to install it manually.";
  }

  return undefined;
}
