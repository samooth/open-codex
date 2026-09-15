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

describe("MultilineTextEditor – newline on \\n, submit on \\r", () => {
  it("inserts newline on \\n and does NOT submit", async () => {
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

    await type(stdin, "foo", flush);
    await new Promise((r) => setTimeout(r, 100));
    await type(stdin, "\n", flush);
    await type(stdin, "bar", flush);

    const frame = lastFrameStripped();
    expect(frame).toMatch(/foo/);
    expect(frame).toMatch(/bar/);

    expect(onSubmit).not.toHaveBeenCalled();

    cleanup();
  });
});
