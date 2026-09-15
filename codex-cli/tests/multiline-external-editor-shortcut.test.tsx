import { renderTui } from "./ui-test-helpers.js";
import MultilineTextEditor from "../src/components/chat/multiline-editor.js";
import TextBuffer from "../src/text-buffer.js";
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

describe("MultilineTextEditor – external editor shortcut", () => {
  it("fires openInExternalEditor on Ctrl+E (single key)", async () => {
    const spy = vi
      .spyOn(TextBuffer.prototype as any, "openInExternalEditor")
      .mockResolvedValue(undefined);

    const { stdin, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        initialText: "hello",
        width: 20,
        height: 3,
      }),
    );

    await flush();

    await type(stdin, "\x05", flush);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    cleanup();
  });

  it("fires openInExternalEditor on Ctrl+X (single key)", async () => {
    const spy = vi
      .spyOn(TextBuffer.prototype as any, "openInExternalEditor")
      .mockResolvedValue(undefined);

    const { stdin, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        initialText: "hello",
        width: 20,
        height: 3,
      }),
    );

    await flush();

    await type(stdin, "\x18", flush);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
    cleanup();
  });
});
