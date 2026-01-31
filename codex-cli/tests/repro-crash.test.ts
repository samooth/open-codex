import { describe, it, expect, vi } from "vitest";
import { parseToolCallChatCompletion, parseToolCall } from "../src/utils/parsers";

describe("parseToolCallChatCompletion reproduction", () => {
  it("should not crash when tool call has arguments for non-shell tool", () => {
    const toolCall: any = {
      type: "function",
      function: {
        name: "search_codebase",
        arguments: JSON.stringify({ pattern: "foo" }),
      },
    };

    // This used to throw "Cannot destructure property 'cmd' of 'result.args' as it is undefined."
    const details = parseToolCallChatCompletion(toolCall);
    
    expect(details).toBeDefined();
    expect(details?.cmd).toEqual([]);
    expect(details?.cmdReadableText).toContain("search_codebase");
  });

  it("should not crash when parseToolCall has arguments for non-shell tool", () => {
    const toolCall: any = {
      type: "function",
      function: {
        name: "search_codebase",
        arguments: JSON.stringify({ pattern: "foo" }),
      },
    };

    const details = parseToolCall(toolCall);
    
    expect(details).toBeDefined();
    expect(details?.cmd).toEqual([]);
    expect(details?.cmdReadableText).toContain("search_codebase");
  });
});
