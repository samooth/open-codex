import { renderTui } from "./ui-test-helpers.js";
import TerminalChatInput from "../src/components/chat/terminal-chat-input.js";
import * as React from "react";
import { describe, it, expect, vi } from "vitest";
import { themes } from "../src/utils/theme.js";
import { AppProvider } from "../src/contexts/app-context.js";

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

async function type(stdin: any, text: string, flush: () => Promise<void>) {
  for (const char of text) {
    stdin.write(char);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flush();
  }
}

function stubProps(): any {
  return {
    isNew: true,
    loading: false,
    submitInput: vi.fn(),
    confirmationPrompt: null,
    submitConfirmation: vi.fn(),
    setPrevItems: vi.fn(),
    setItems: vi.fn(),
    contextLeftPercent: 100,
    openOverlay: vi.fn(),
    openModelOverlay: vi.fn(),
    openHelpOverlay: vi.fn(),
    openConfigOverlay: vi.fn(),
    openPromptOverlay: vi.fn(),
    openPromptsOverlay: vi.fn(),
    openRecipesOverlay: vi.fn(),
    openThemeOverlay: vi.fn(),
    onPin: vi.fn(),
    onUnpin: vi.fn(),
    onUndo: vi.fn(),
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

describe("Multiline Input Growth", () => {
  it("should grow in height when newlines are added", async () => {
    const { stdin, lastFrameStripped, flush, cleanup } = renderTui(
      <AppProvider
        initialConfig={{
          model: "o4-mini",
          instructions: "",
        }}
      >
        <TerminalChatInput {...stubProps()} />
      </AppProvider>,
    );

    await flush();

    await type(stdin, "line1", flush);
    await new Promise((r) => setTimeout(r, 100));
    stdin.write("\n");
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flush();
    await type(stdin, "line2", flush);

    const frame = lastFrameStripped();
    expect(frame).toContain("line1");
    expect(frame).toContain("line2");

    cleanup();
  });
});
