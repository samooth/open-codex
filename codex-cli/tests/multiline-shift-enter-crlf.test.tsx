// En la implementación actual, \\r siempre es submit y \\n es newline.
// Este test verifica esa contract en lugar de un modifier de Shift sobre \\r
// que hoy por hoy no está soportado en el parser de entrada.

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

describe("MultilineTextEditor – \\r submits, \\n newlines", () => {
  it("submits on \\r and inserts newline on \\n", async () => {
    const onSubmit = vi.fn();

    const { stdin, flush, cleanup } = renderTui(
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
    await type(stdin, "\r", flush);

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0]![0]).toBe("foo");

    cleanup();
  });

  it("inserts a newline on \\n without submitting", async () => {
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
    expect(frame.split("\n").length).toBeGreaterThanOrEqual(2);

    expect(onSubmit).not.toHaveBeenCalled();

    cleanup();
  });
});
