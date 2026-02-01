/**
 * Utility functions for handling platform-specific commands
 */

import { log, isLoggingEnabled } from "./log.js";

/**
 * Map of Unix commands to their Windows equivalents
 */
const COMMAND_MAP: Record<string, string> = {
  ls: "dir",
  grep: "findstr",
  cat: "type",
  rm: "del",
  cp: "copy",
  mv: "move",
  touch: "echo.>",
  mkdir: "md",
  rmdir: "rd",
  clear: "cls",
  pwd: "cd",
};

/**
 * Map of common Unix command options to their Windows equivalents
 */
const OPTION_MAP: Record<string, Record<string, string>> = {
  ls: {
    "-l": "", // dir doesn't have a direct equivalent for long format but displays similar info
    "-a": "/a",
    "-R": "/s",
    "-F": "", // dir doesn't have a direct equivalent for file type indicators
  },
  grep: {
    "-i": "/i",
    "-r": "/s",
    "-v": "/v",
    "-n": "/n",
  },
  rm: {
    "-rf": "/s /q",
    "-f": "/q",
    "-r": "/s",
  },
  mkdir: {
    "-p": "", // md creates parents by default on Windows
  },
};

/**
 * Adapts a command for the current platform.
 * On Windows, this will translate Unix commands to their Windows equivalents.
 * On Unix-like systems, this will return the original command.
 *
 * @param command The command array to adapt
 * @returns The adapted command array
 */
export function adaptCommandForPlatform(command: Array<string>): Array<string> {
  // If not on Windows, return the original command
  if (process.platform !== "win32") {
    return command;
  }

  // Nothing to adapt if the command is empty
  if (command.length === 0) {
    return command;
  }

  const cmd = command[0];

  // If cmd is undefined or the command doesn't need adaptation, return it as is
  if (!cmd || !COMMAND_MAP[cmd]) {
    return command;
  }

  if (isLoggingEnabled()) {
    log(`Adapting command '${cmd}' for Windows platform`);
  }

  // Create a new command array with the adapted command
  const adaptedCommand = [...command];
  adaptedCommand[0] = COMMAND_MAP[cmd];

  // Adapt options if needed
  const optionsForCmd = OPTION_MAP[cmd];
  if (optionsForCmd) {
    for (let i = 1; i < adaptedCommand.length; i++) {
      const option = adaptedCommand[i];
      if (option && optionsForCmd[option]) {
        adaptedCommand[i] = optionsForCmd[option];
      }
    }
  }

  if (isLoggingEnabled()) {
    log(`Adapted command: ${adaptedCommand.join(" ")}`);
  }

  return adaptedCommand;
}
