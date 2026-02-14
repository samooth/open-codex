import { describe, it, expect } from "vitest";
import { isSafeCommand, canAutoApprove } from "../src/approvals.js";

describe("Approval Logic", () => {
  describe("isSafeCommand", () => {
    it("approves simple safe commands", () => {
      expect(isSafeCommand(["ls"])).not.toBeNull();
      expect(isSafeCommand(["pwd"])).not.toBeNull();
      expect(isSafeCommand(["git", "status"])).not.toBeNull();
      expect(isSafeCommand(["npm", "search", "react"])).not.toBeNull();
    });

    it("rejects unsafe commands", () => {
      expect(isSafeCommand(["rm", "file.txt"])).toBeNull();
      expect(isSafeCommand(["mv", "old", "new"])).toBeNull();
      expect(isSafeCommand(["chmod", "777", "script.sh"])).toBeNull();
    });

    it("rejects find with unsafe options", () => {
      expect(isSafeCommand(["find", ".", "-name", "*.ts"])).not.toBeNull();
      expect(isSafeCommand(["find", ".", "-delete"])).toBeNull();
      expect(isSafeCommand(["find", ".", "-exec", "rm", "{}", ";"])).toBeNull();
    });

    it("approves safe complex git commands", () => {
      expect(isSafeCommand(["git", "diff"])).not.toBeNull();
      expect(isSafeCommand(["git", "log"])).not.toBeNull();
      // Unsafe git actions
      expect(isSafeCommand(["git", "push"])).toBeNull();
      expect(isSafeCommand(["git", "commit"])).toBeNull();
    });
  });

  describe("canAutoApprove Shell Expressions", () => {
    const writableRoots = ["/safe/path"];

    // Helper to simulate the CLI behavior where bash -lc is used
    function assess(cmdString: string, policy: "suggest" | "auto-edit" | "full-auto" = "suggest") {
      const command = ["bash", "-lc", cmdString];
      return canAutoApprove(command, policy, writableRoots);
    }

    it("auto-approves chained safe commands", () => {
      const result = assess("ls && pwd");
      expect(result.type).toBe("auto-approve");
    });

    it("auto-approves piped safe commands", () => {
      const result = assess("cat file.txt | grep 'something'");
      expect(result.type).toBe("auto-approve");
    });

    it("rejects chains with one unsafe command", () => {
      const result = assess("ls && rm file.txt");
      expect(result.type).toBe("ask-user");
    });

    it("rejects unsafe pipes", () => {
      const result = assess("cat file.txt | xargs rm");
      expect(result.type).toBe("ask-user");
    });

    it("rejects subshells (too complex to validate safely)", () => {
      const result = assess("(ls && pwd)");
      expect(result.type).toBe("ask-user");
    });
  });
});
