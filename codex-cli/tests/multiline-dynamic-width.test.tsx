import { renderTui } from "./ui-test-helpers.js";
import MultilineTextEditor from "../src/components/chat/multiline-editor.js";
import * as React from "react";
import { describe, it, expect } from "vitest";

async function type(
  stdin: NodeJS.WritableStream,
  text: string,
  flush: () => Promise<void>,
) {
  stdin.write(text);
  await flush();
}

describe("MultilineTextEditor – dynamic width", () => {
  it("renders text within the provided width", async () => {
    process.stdout.columns = 40;

    const { stdin, lastFrame, flush, cleanup } = renderTui(
      React.createElement(MultilineTextEditor, {
        initialText: "",
        width: 20,
        height: 3,
      }),
    );

    await flush();

    const alphabet = "abcdefghijklmnopqrstuvwxyz";
    await type(stdin, alphabet, flush);

    expect(lastFrame()?.includes("z")).toBe(true);

    cleanup();
  });
});
