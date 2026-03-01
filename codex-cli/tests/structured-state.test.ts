import { describe, it, expect } from "vitest";
import {
  parseStateSnapshot,
  formatStateForPrompt,
} from "../src/utils/agent/state-manager.js";

describe("Structured State Management", () => {
  describe("parseStateSnapshot", () => {
    it("parses a complete snapshot from thinking content", () => {
      const content = `
<thought>
I'll begin by analyzing the auth flow.
<state_snapshot>
  <overall_goal>Implement OAuth2 provider</overall_goal>
  <active_constraints>
    - No external libraries for crypto
    - Use async/await
  </active_constraints>
  <key_knowledge>
    - The server uses port 3000
    - Secret keys are in .env
  </key_knowledge>
  <artifact_trail>
    - src/auth.ts
    - src/index.ts
  </artifact_trail>
  <task_state>
    - [DONE] Setup routes
    - [IN_PROGRESS] Implement token logic
    - [TODO] Add tests
  </task_state>
</state_snapshot>
</thought>
`;
      const snapshot = parseStateSnapshot(content);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.overall_goal).toBe("Implement OAuth2 provider");
      expect(snapshot?.active_constraints).toEqual([
        "No external libraries for crypto",
        "Use async/await",
      ]);
      expect(snapshot?.key_knowledge).toEqual([
        "The server uses port 3000",
        "Secret keys are in .env",
      ]);
      expect(snapshot?.artifact_trail).toEqual(["src/auth.ts", "src/index.ts"]);
      expect(snapshot?.task_state).toEqual([
        "- [DONE] Setup routes",
        "- [IN_PROGRESS] Implement token logic",
        "- [TODO] Add tests",
      ]);
    });

    it("returns null if no tags are found", () => {
      expect(parseStateSnapshot("just some plain text")).toBeNull();
    });

    it("parses partial snapshots", () => {
      const content = "<overall_goal>Simple Goal</overall_goal>";
      const snapshot = parseStateSnapshot(content);
      expect(snapshot).toEqual({ overall_goal: "Simple Goal" });
    });
  });

  describe("formatStateForPrompt", () => {
    it("formats a snapshot for system prompt injection", () => {
      const snapshot = {
        overall_goal: "Goal",
        active_constraints: ["C1"],
        task_state: ["[DONE] T1"],
      };
      const formatted = formatStateForPrompt(snapshot);
      expect(formatted).toContain("Overall Goal: Goal");
      expect(formatted).toContain("- C1");
      expect(formatted).toContain("[DONE] T1");
      expect(formatted).toContain("--- CURRENT MISSION STATE ---");
    });
  });
});
