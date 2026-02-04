import { describe, it, expect } from "vitest";
import { requiresShell } from "../src/utils/agent/exec.js";

describe("requiresShell function (actual implementation)", () => {
  const isWindows = process.platform === "win32";

  it("should return true for single argument commands (on POSIX)", () => {
    if (isWindows) return; // Windows always returns true
    expect(requiresShell(['ls'])).toBe(true);
    expect(requiresShell(['ls -la'])).toBe(true);
  });

  it("should return false for multi-argument commands without operators (on POSIX)", () => {
    if (isWindows) return;
    expect(requiresShell(['ls', '-la'])).toBe(false);
    expect(requiresShell(['git', 'status'])).toBe(false);
  });

  it("should return true if arguments contain shell operators", () => {
    // Pipe
    expect(requiresShell(['grep', 'foo', '|', 'head'])).toBe(true);
    // Redirect
    expect(requiresShell(['echo', 'hello', '>', 'file.txt'])).toBe(true);
    // Background
    expect(requiresShell(['sleep', '10', '&'])).toBe(true);
    // Sequence
    expect(requiresShell(['echo', 'a', ';', 'echo', 'b'])).toBe(true);
  });

  it("should return true if an argument contains complex shell syntax", () => {
    expect(requiresShell(['sh', '-c', 'echo hello && echo world'])).toBe(true);
  });
});