import { renderTui } from "./ui-test-helpers.js";
import TerminalChatInput from "../src/components/chat/terminal-chat-input.js";
import * as React from "react";
import { describe, it, vi } from "vitest";
import { themes } from "../src/utils/theme.js";

vi.mock("../src/utils/input-utils.js", () => ({
  createInputItem: vi.fn(async (text: string) => ({
    role: "user",
    type: "message",
    content: [{ type: "input_text", text }],
  })),
}));

vi.mock("../src/format-command.js", () => ({
  formatCommandForDisplay: (cmd: Array<string>) => cmd.join(" "),
}));
vi.mock("../src/approvals.js", () => ({
  isSafeCommand: (_cmd: Array<string>) => null,
}));

async function type(
  stdin: NodeJS.WritableStream,
  text: string,
  flush: () => Promise<void>,
) {
  stdin.write(text);
  await flush();
}

function stubProps(): any {
  return {
    isNew: true,
    loading: false,
    submitInput: vi.fn(),
    confirmationPrompt: null,
    submitConfirmation: vi.fn(),
    setLastResponseId: vi.fn(),
    setItems: (() => {}) as any,
    contextLeftPercent: 100,
    openOverlay: vi.fn(),
    openModelOverlay: vi.fn(),
    openHelpOverlay: vi.fn(),
    interruptAgent: vi.fn(),
    active: true,
    theme: themes["default"],
    allFiles: [],
    config: {
      model: "o4-mini",
      instructions: "",
      editorCommand: undefined,
      enableWebSearch: true,
      enableDeepThinking: false,
      enableDeepLinter: false,
      enableSmartContext: true,
    },
  };
}

describe("TerminalChatInput – history navigation", () => {
  it("submits the current draft with Enter", async () => {
    const { stdin, flush, cleanup } = renderTui(
      React.createElement(TerminalChatInput, stubProps()),
    );

    await flush();

    await type(stdin, "hello", flush);
    await new Promise((r) => setTimeout(r, 100));
    await type(stdin, "\r", flush);

    await flush();

    cleanup();
  });
});
