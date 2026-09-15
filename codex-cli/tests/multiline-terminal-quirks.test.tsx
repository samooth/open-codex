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

describe("MultilineTextEditor – terminal quirks", () => {
  it("submits on \\r with default focus", async () => {
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

    await type(stdin, "\r", flush);

    expect(onSubmit).toHaveBeenCalledWith("test content");

    cleanup();
  });

  it("inserts newline on \\n without submitting", async () => {
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

    await new Promise((r) => setTimeout(r, 100));
    await type(stdin, "\n", flush);
    await type(stdin, "Line2", flush);

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrameStripped();
    expect(frame).toContain("Line1");
    expect(frame).toContain("Line2");

    cleanup();
  });

  it("inserts newline on Ctrl+J (\\n) without submitting", async () => {
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

    await new Promise((r) => setTimeout(r, 100));
    await type(stdin, "\n", flush);
    await type(stdin, "Line2", flush);

    expect(onSubmit).not.toHaveBeenCalled();
    const frame = lastFrameStripped();
    expect(frame).toContain("Line1");
    expect(frame).toContain("Line2");

    cleanup();
  });
});
