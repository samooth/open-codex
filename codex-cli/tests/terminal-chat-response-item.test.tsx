import { renderTui } from "./ui-test-helpers.js";
import TerminalChatResponseItem from "../src/components/chat/terminal-chat-response-item.js";
import { themes } from "../src/utils/theme.js";
import React from "react";
import { describe, it, expect } from "vitest";

// Component under test

// The ResponseItem type is complex and imported from the OpenAI SDK. To keep
// this test lightweight we construct the minimal runtime objects we need and
// cast them to `any` so that TypeScript is satisfied.

function userMessage(text: string) {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text,
      },
    ],
  } as any;
}

function assistantMessage(text: string) {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text,
      },
    ],
  } as any;
}

describe("TerminalChatResponseItem", () => {
  it("renders a user message", () => {
    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem item={userMessage("Hello world")} theme={themes["default"]!} />,
    );

    const frame = lastFrameStripped();
    expect(frame).toContain("user");
    expect(frame).toContain("Hello world");
  });

  it("renders an assistant message", () => {
    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem item={assistantMessage("Sure thing")} theme={themes["default"]!} />,
    );

    const frame = lastFrameStripped();
    // assistant messages are labelled "codex" in the UI
    expect(frame.toLowerCase()).toContain("codex");
    expect(frame).toContain("Sure thing");
  });

  it("renders an integrated tool response box", () => {
    const toolCall = {
      id: "call_1",
      type: "function",
      function: {
        name: "list_directory",
        arguments: '{"path":"."}',
      },
    };
    const toolMessage = {
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({
        output: "file1.txt\nfile2.txt",
        metadata: { exit_code: 0 },
      }),
    } as any;
    const toolCallMap = new Map();
    toolCallMap.set("call_1", toolCall);

    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem item={toolMessage} toolCallMap={toolCallMap} theme={themes["default"]!} />,
    );

    const frame = lastFrameStripped();
    // integrated header should show tool info (label mapping list_directory -> listing)
    expect(frame).toContain("listing");
    expect(frame).toContain(".");
    // output should be shown
    expect(frame).toContain("file1.txt");
    expect(frame).toContain("file2.txt");
  });
});
