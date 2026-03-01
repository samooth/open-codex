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
      <TerminalChatResponseItem
        item={userMessage("Hello world")}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    expect(frame).toContain("USER");
    expect(frame).toContain("Hello world");
  });

  it("renders an assistant message", () => {
    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem
        item={assistantMessage("Sure thing")}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    // assistant messages are labelled "ASSISTANT" in the UI
    expect(frame.toUpperCase()).toContain("ASSISTANT");
    expect(frame).toContain("Sure thing");
    expect(frame).toContain("gpt-4o");
  });

  it("renders an assistant message with thoughts", () => {
    const item = {
      role: "assistant",
      content:
        "<thought>I should check the file first</thought>I will check the file.",
    } as any;

    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem
        item={item}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    expect(frame.toLowerCase()).toContain("( thought )");
    expect(frame).toContain("I should check the file first");
    expect(frame).toContain("I will check the file.");
  });

  it("renders an assistant message with a plan", () => {
    const item = {
      role: "assistant",
      content: "<plan>1. Read file\n2. Edit file</plan>Starting the plan.",
    } as any;

    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem
        item={item}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    expect(frame.toUpperCase()).toContain("PLAN");
    expect(frame).toContain("1. Read file");
    expect(frame).toContain("Starting the plan.");
  });

  it("renders markdown code blocks with borders and language label", () => {
    const message = assistantMessage(
      "Here is some code:\n```typescript\nconst x = 1;\n```",
    );
    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem
        item={message}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    expect(frame.toUpperCase()).toContain("TYPESCRIPT");
    expect(frame).toContain("const x = 1;");
    // The border is bold, which rendered as some character or space in stripped output,
    // but we can check if the language label is present.
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
      <TerminalChatResponseItem
        item={toolMessage}
        toolCallMap={toolCallMap}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    // integrated header should show tool info (label mapping list_directory -> LISTING)
    expect(frame.toUpperCase()).toContain("LISTING");
    expect(frame).toContain(".");
    // output should be shown
    expect(frame).toContain("file1.txt");
    expect(frame).toContain("file2.txt");
  });

  it("renders an assistant message with only reasoning_content", () => {
    const item = {
      role: "assistant",
      content: "",
      reasoning_content: "I am thinking deeply",
    } as any;

    const { lastFrameStripped } = renderTui(
      <TerminalChatResponseItem
        item={item}
        theme={themes["default"]!}
        model="gpt-4o"
      />,
    );

    const frame = lastFrameStripped();
    expect(frame.toLowerCase()).toContain("( thought )");
    expect(frame).toContain("I am thinking deeply");
  });
});
