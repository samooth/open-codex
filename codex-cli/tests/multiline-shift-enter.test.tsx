import { renderTui } from "./ui-test-helpers.js";
import MultilineTextEditor from "../src/components/chat/multiline-editor.js";
import * as React from "react";
import { describe, it, expect, vi } from "vitest";

async function type(
  stdin: any,
  text: string,
  flush: () => Promise<void>,
  key: any = {},
) {
  stdin.write(text, key);
  await flush();
}

describe("MultilineTextEditor – Shift+Enter", () => {
  it("inserts a newline instead of submitting", async () => {
    const onSubmit = vi.fn();

    const { stdin, lastFrameStripped, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        height: 5,
        width: 20,
        initialText: "",
        onSubmit,
      }),
    );

    await flush();

    // type 'hi'
    await type(stdin, "hi", flush);

    // send Shift+Enter (\n)
    await type(stdin, "\n", flush, { shift: true });

    // type 'there'
    await type(stdin, "there", flush);

    const frame = lastFrameStripped();
    expect(frame).toMatch(/hi/);
    expect(frame).toMatch(/there/);

    // Shift+Enter must not trigger submission
    expect(onSubmit).not.toHaveBeenCalled();

    cleanup();
  });
});
