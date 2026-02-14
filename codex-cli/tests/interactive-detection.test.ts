import { describe, it, expect } from "vitest";
import { detectInteraction } from "../src/utils/interactive-detection.js";

describe("Interactive Interaction Detection", () => {
  describe("Yes/No Detection", () => {
    it("detects basic confirmation questions", () => {
      expect(detectInteraction("Should I proceed?")).toEqual({ type: "yes-no" });
      expect(detectInteraction("Continue?")).toEqual({ type: "yes-no" });
      expect(detectInteraction("Is this correct?")).toEqual({ type: "yes-no" });
    });

    it("detects explicit (yes/no) markers", () => {
      expect(detectInteraction("Ready to apply changes (yes/no)")).toEqual({ type: "yes-no" });
    });

    it("detects complex phrasing with question marks", () => {
      expect(detectInteraction("Would you like me to fix the bug?")).toEqual({ type: "yes-no" });
      expect(detectInteraction("Shall I delete the file?")).toEqual({ type: "yes-no" });
    });

    it("returns null for non-confirmation questions", () => {
      expect(detectInteraction("What is the name of the file?")).toBeNull();
      expect(detectInteraction("How does this work?")).toBeNull();
      expect(detectInteraction("How should I proceed?")).toBeNull();
      expect(detectInteraction("How can I fix this?")).toBeNull();
      expect(detectInteraction("### How would you like to proceed?")).toBeNull();
    });
  });

  describe("Multi-choice Detection", () => {
    it("detects choices in brackets at the end of text", () => {
      const msg = "What would you like to do? [Option A] [Option B]";
      expect(detectInteraction(msg)).toEqual({
        type: "choices",
        choices: ["Option A", "Option B"]
      });
    });

    it("detects choices when explicitly asked to select", () => {
      const msg = "Please select one: [Retry] [Ignore] [Abort]. This will affect the build.";
      expect(detectInteraction(msg)).toEqual({
        type: "choices",
        choices: ["Retry", "Ignore", "Abort"]
      });
    });

    it("filters out long or redundant entries", () => {
      const msg = "Here are the results [Small] [This is a very long string that should probably not be a button in the TUI].";
      // Should still match because the first one is valid, and the second is filtered by length
      // Actually, my logic requires at least 2 valid ones.
      const result = detectInteraction(msg);
      expect(result).toBeNull();
    });

    it("deduplicates choices", () => {
      const msg = "Pick: [A] [B] [A]";
      expect(detectInteraction(msg)).toEqual({
        type: "choices",
        choices: ["A", "B"]
      });
    });
  });
});
