import { renderTui } from "./ui-test-helpers.js";
import MultilineTextEditor from "../src/components/chat/multiline-editor.js";
import * as React from "react";
import { describe, it, expect, vi } from "vitest";

async function type(
  stdin: NodeJS.WritableStream,
  text: string,
  flush: () => Promise<void>,
) {
  stdin.write(text);
  await flush();
}

describe("MultilineTextEditor - Terminal Quirks", () => {
  it("should submit on Carriage Return even if shift is incorrectly reported as true", async () => {
    const onSubmit = vi.fn();
    const { stdin, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        height: 5,
        width: 40,
        initialText: "test content",
        onSubmit,
      }),
    );

    await flush();

    // Simulate the quirk: \r with shift: true
    stdin.emit("data", "\r");
    await flush();
    
    expect(onSubmit).toHaveBeenCalledWith("test content");

    cleanup();
  });

  it("should insert newline on Alt+Enter sequence", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrameStripped, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        height: 5,
        width: 40,
        initialText: "Line1",
        onSubmit,
      }),
    );

    await flush();

    // Type Alt+Enter sequence (\u001b then \r)
    stdin.emit("data", "\u001b");
    await flush();
    stdin.emit("data", "\r");
    await flush();
    
    await type(stdin, "Line2", flush);

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrameStripped();
    expect(frame).toContain("Line1");
    expect(frame).toContain("Line2");

    cleanup();
  });

  it("should insert newline on Ctrl+J", async () => {
    const onSubmit = vi.fn();
    const { stdin, lastFrameStripped, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        height: 5,
        width: 40,
        initialText: "Line1",
        onSubmit,
      }),
    );

    await flush();

    // Type Ctrl+J (\n)
    await type(stdin, "\n", flush);
    await type(stdin, "Line2", flush);

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrameStripped();
    expect(frame).toContain("Line1");
    expect(frame).toContain("Line2");

    cleanup();
  });
});
