
import { parseToolCallArguments } from "../src/utils/parsers";
import { describe, it, expect } from "vitest";

describe("MCP Parameter Passthrough", () => {
  it("should preserve 'url' parameter which is not in the base schema", () => {
    const rawArgs = JSON.stringify({
      url: "http://localhost:3000",
      handleBeforeUnload: "accept"
    });
    
    const result = parseToolCallArguments(rawArgs);
    
    expect(result.success).toBe(true);
    if (result.success && 'data' in result) {
      expect(result.data).toHaveProperty("url", "http://localhost:3000");
      expect(result.data).toHaveProperty("handleBeforeUnload", "accept");
    } else {
      throw new Error("Expected result to have 'data' property");
    }
  });

  it("should preserve 'pageIdx' and other numeric parameters", () => {
    const rawArgs = JSON.stringify({
      pageIdx: 0,
      someOtherParam: 123
    });
    
    const result = parseToolCallArguments(rawArgs);
    
    expect(result.success).toBe(true);
    if (result.success && 'data' in result) {
      expect(result.data).toHaveProperty("pageIdx", 0);
      expect(result.data).toHaveProperty("someOtherParam", 123);
    } else {
       throw new Error("Expected result to have 'data' property");
    }
  });

  it("should still validate existing schema properties and wrap in 'args' if they are command-like", () => {
    // If it has 'command' or 'cmd', it gets wrapped into 'args' (ExecInput)
    const rawArgs = JSON.stringify({
      command: ["ls"],
      path: "/tmp",
      newCustomParam: "custom"
    });
    
    const result = parseToolCallArguments(rawArgs);
    
    expect(result.success).toBe(true);
    if (result.success && 'args' in result) {
      expect(result.args).toHaveProperty("cmd");
      expect(Array.isArray(result.args.cmd)).toBe(true);
      expect(result.args.cmd).toContain("ls");
      expect(result.args).toHaveProperty("newCustomParam", "custom");
    }
  });
});
