import { renderTui } from "./ui-test-helpers.js";
import { Markdown } from "../src/components/chat/terminal-chat-response-item.js";
import { themes } from "../src/utils/theme.js";
import React from "react";
import { it, expect } from "vitest";

/** Simple sanity check that the Markdown component renders bold/italic text.
 * We strip ANSI codes, so the output should contain the raw words. */
it("renders basic markdown", () => {
  const { lastFrameStripped } = renderTui(
    <Markdown theme={themes["default"]!}>**bold** _italic_</Markdown>,
  );

  const frame = lastFrameStripped();
  expect(frame).toContain("bold");
  expect(frame).toContain("italic");
});

it("renders code blocks without exposing internal markers", () => {
  const code = "console.log('hello');";
  const markdown = "Here is some code:\n```javascript\n" + code + "\n```";
  const { lastFrame } = renderTui(
    <Markdown theme={themes["default"]!}>{markdown}</Markdown>,
  );

  const frame = lastFrame();
  expect(frame).toContain("hello");
  expect(frame).not.toContain("CODE_BLOCK_START");
  expect(frame).not.toContain("CODE_BLOCK_END");
});

it("renders complex markdown with multiple code blocks correctly", () => {
  const markdown = `
# Title
Some text.
\`\`\`typescript
interface A { a: string; }
\`\`\`
More text.
\`\`\`python
def hello(): print("world")
\`\`\`
Final text.
  `;
  const { lastFrame } = renderTui(
    <Markdown theme={themes["default"]!}>{markdown}</Markdown>,
  );

  const frame = lastFrame();
  expect(frame).toContain("interface A");
  expect(frame).toContain("def hello");
  expect(frame).not.toContain("CID_CB_PLACEHOLDER");
});
