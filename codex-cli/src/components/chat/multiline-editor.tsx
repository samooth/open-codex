/* eslint-disable @typescript-eslint/no-explicit-any */

import { useTerminalSize } from "../../hooks/use-terminal-size";
import TextBuffer from "../../text-buffer.js";
import chalk from "chalk";
import { Box, Text, useInput, useStdin } from "ink";
import React, { useRef, useState, useEffect } from "react";

export interface MultilineTextEditorProps {
  // Initial contents.
  readonly initialText?: string;

  // Visible width.
  readonly width?: number;

  // Visible height.
  readonly height?: number;

  // Called when the user submits (plain <Enter> key).
  readonly onSubmit?: (text: string) => void;

  // Capture keyboard input.
  readonly focus?: boolean;

  // Called when the internal text buffer updates.
  readonly onChange?: (text: string) => void;

  /**
   * Custom key down handler. Return true to prevent default behavior.
   */
  readonly onKeyDown?: (input: string, key: any) => boolean;
}

// Expose a minimal imperative API so parent components (e.g. TerminalChatInput)
// can query the caret position to implement behaviours like history
// navigation that depend on whether the cursor sits on the first/last line.
export interface MultilineTextEditorHandle {
  /** Current caret row */
  getRow(): number;
  /** Current caret column */
  getCol(): number;
  /** Total number of lines in the buffer */
  getLineCount(): number;
  /** Helper: caret is on the very first row */
  isCursorAtFirstRow(): boolean;
  /** Helper: caret is on the very last row */
  isCursorAtLastRow(): boolean;
  /** Full text contents */
  getText(): string;
}

const MultilineTextEditorInner = (
  {
    initialText = "",
    // Width can be provided by the caller.  When omitted we fall back to the
    // current terminal size (minus some padding handled by `useTerminalSize`).
    width,
    height = 10,
    onSubmit,
    focus = true,
    onChange,
    onKeyDown,
  }: MultilineTextEditorProps,
  ref: React.Ref<MultilineTextEditorHandle | null>,
): React.ReactElement => {
  // ---------------------------------------------------------------------------
  // Editor State
  // ---------------------------------------------------------------------------

  const buffer = useRef(new TextBuffer(initialText));
  const [version, setVersion] = useState(0);
  
  // Track raw escape sequences from stdin to detect Alt+Enter robustly
  const lastRawWasEscape = useRef(false);
  const { stdin, setRawMode } = useStdin();

  useEffect(() => {
    if (!stdin) return;
    const handleData = (data: Buffer | string) => {
      const s = data.toString();
      // If we see a raw ESC byte (0x1b), mark it. 
      // This helps detect Alt+Enter even if Ink's parser splits or strips it.
      if (s === "\u001b" || s === "\x1b" || s.startsWith("\u001b")) {
        lastRawWasEscape.current = true;
      }
    };
    stdin.on("data", handleData);
    return () => {
      stdin.off("data", handleData);
    };
  }, [stdin]);

  // Sync with initialText if it changes from outside (e.g. autocomplete)
  useEffect(() => {
    if (initialText !== buffer.current.getText()) {
      buffer.current = new TextBuffer(initialText);
      // Place cursor at the end of the text (useful for autocomplete)
      const lines = buffer.current.getLines();
      const lastRow = lines.length - 1;
      const lastCol = Array.from(lines[lastRow] || "").length;
      buffer.current.setCursor(lastRow, lastCol);
      setVersion((v) => v + 1);
    }
  }, [initialText]);

  // Keep track of the current terminal size so that the editor grows/shrinks
  // with the window.  `useTerminalSize` already subtracts a small horizontal
  // padding so that we don't butt up right against the edge.
  const terminalSize = useTerminalSize();

  // If the caller didn't specify a width we dynamically choose one based on
  // the terminal's current column count.  We still enforce a reasonable
  // minimum so that the UI never becomes unusably small.
  const effectiveWidth = Math.max(20, width ?? terminalSize.columns);

  /**
   * Launch the user's preferred $EDITOR, blocking until they close it, then
   * reload the edited file back into the in‑memory TextBuffer.
   */
  const openExternalEditor = React.useCallback(async () => {
    const wasRaw = stdin?.isRaw ?? false;
    try {
      setRawMode?.(false);
      await buffer.current.openInExternalEditor();
    } catch (err) {
      console.error("[MultilineTextEditor] external editor error", err);
    } finally {
      if (wasRaw) {
        setRawMode?.(true);
      }
      setVersion((v) => v + 1);
    }
  }, [buffer, stdin, setRawMode]);

  // ---------------------------------------------------------------------------
  // Keyboard handling.
  // ---------------------------------------------------------------------------

  useInput(
    (input, key) => {
      if (!focus) {
        return;
      }

      // Check if this event was preceded by a raw Escape byte (Alt sequence)
      const isAlt = key.meta || lastRawWasEscape.current || input.includes("\u001b");
      
      // Reset the raw escape flag after we've checked it for this event
      if (input.length > 0) {
        lastRawWasEscape.current = false;
      }

      // Explicit Line Feed (\n) is usually Ctrl+J or Shift+Enter.
      const isLineFeed = input === "\n" || input === "\u000A";

      // Standardize return key for raw bytes
      if ((input === "\r" || isLineFeed || isAlt) && key.return === false) {
        (key as any).return = true;
      }

      if (onKeyDown?.(input, key)) {
        return;
      }

      // Single‑step editor shortcuts
      const isCtrlX = (key.ctrl && input === "x") || (input === "\x18" && input.length === 1);
      const isCtrlE = (key.ctrl && input === "e") || (input === "\x05" && input.length === 1);
      if (isCtrlX || isCtrlE) {
        openExternalEditor();
        return;
      }

      if (process.env["TEXTBUFFER_DEBUG"] === "1") {
        console.error("[MultilineTextEditor] event", { 
          input, 
          hex: input.split("").map(c => c.charCodeAt(0).toString(16)).join(" "),
          isAlt,
          key 
        });
      }

      // 1) CSI sequences -------------------------------------------------------
      if (input.startsWith("[") || input.startsWith("\u001b[")) {
        // CSI-u (mode 2)
        const mU = input.match(/\[([0-9]+);([0-9]+)u$/);
        if (mU && mU[1] === "13") {
          const mod = Number(mU[2]);
          const hasShift = (mod - 1) % 2 === 1;
          const hasAltMod = Math.floor((mod - 1) / 2) % 2 === 1;
          if (hasShift || hasAltMod) {
            buffer.current.newline();
          } else if (onSubmit) {
            onSubmit(buffer.current.getText());
          } else {
            buffer.current.newline();
          }
          setVersion((v) => v + 1);
          return;
        }
        // CSI-~ (mode 1)
        const mT = input.match(/\[27;([0-9]+);13~$/);
        if (mT) {
          const mod = Number(mT[1]);
          const hasShift = (mod - 1) % 2 === 1;
          const hasAltMod = Math.floor((mod - 1) / 2) % 2 === 1;
          if (hasShift || hasAltMod) {
            buffer.current.newline();
          } else if (onSubmit) {
            onSubmit(buffer.current.getText());
          } else {
            buffer.current.newline();
          }
          setVersion((v) => v + 1);
          return;
        }
      }

      // 2) Single‑byte / control chars -----------------------------------------
      
      const isReturn = key.return || input.includes("\r") || input.includes("\n");
      if (isReturn) {
        if (key.ctrl) {
          onSubmit?.(buffer.current.getText());
          return;
        }

        // Newline triggers: Explicit Line Feed (\n) or Alt sequence.
        // NOTE: We ignore Shift+Enter if it's a plain \r because many terminals 
        // incorrectly report Shift for a plain Enter. Use Ctrl+J or Alt+Enter for newlines.
        const isNewlineRequest = isLineFeed || isAlt;

        if (isNewlineRequest) {
          buffer.current.newline();
          setVersion((v) => v + 1);
          return;
        }

        // Plain Enter (\r) – submit.
        if (onSubmit) {
          if (process.env["TEXTBUFFER_DEBUG"] === "1") {
            console.error(`[MultilineTextEditor] triggering onSubmit. text=${JSON.stringify(buffer.current.getText())}`);
          }
          onSubmit(buffer.current.getText());
        } else {
          buffer.current.newline();
          setVersion((v) => v + 1);
        }
        return;
      }

      // Let <Esc> fall through so the parent handler (if any) can act on it.

      // Delegate remaining keys to our pure TextBuffer
      const modified = buffer.current.handleInput(
        input,
        key as Record<string, boolean>,
        { height, width: effectiveWidth },
      );
      if (modified) {
        setVersion((v) => v + 1);
      }

      const newText = buffer.current.getText();
      if (onChange) {
        onChange(newText);
      }
    },
    { isActive: focus },
  );

  // ---------------------------------------------------------------------------
  // Imperative handle
  // ---------------------------------------------------------------------------

  React.useImperativeHandle(
    ref,
    () => ({
      getRow: () => buffer.current.getCursor()[0],
      getCol: () => buffer.current.getCursor()[1],
      getLineCount: () => buffer.current.getText().split("\n").length,
      isCursorAtFirstRow: () => buffer.current.getCursor()[0] === 0,
      isCursorAtLastRow: () => {
        const [row] = buffer.current.getCursor();
        const lineCount = buffer.current.getText().split("\n").length;
        return row === lineCount - 1;
      },
      getText: () => buffer.current.getText(),
    }),
    [],
  );

  const visibleLines = buffer.current.getVisibleLines({
    height,
    width: effectiveWidth,
  });

  const paddedLines = [...visibleLines];
  while (paddedLines.length < height) {
    paddedLines.push("");
  }

  const [cursorRow, cursorCol] = buffer.current.getCursor();
  const scrollRow = (buffer.current as any).scrollRow as number;
  const scrollCol = (buffer.current as any).scrollCol as number;

  return (
    <Box flexDirection="column" key={version}>
      {paddedLines.map((lineText, idx) => {
        const absoluteRow = scrollRow + idx;
        let display = lineText.slice(scrollCol, scrollCol + effectiveWidth);
        if (display.length < effectiveWidth) {
          display = display.padEnd(effectiveWidth, " ");
        }

        if (absoluteRow === cursorRow) {
          const relativeCol = cursorCol - scrollCol;
          if (relativeCol >= 0 && relativeCol < effectiveWidth) {
            const charToHighlight = display[relativeCol] || " ";
            const highlighted = chalk.inverse(charToHighlight);
            display = display.slice(0, relativeCol) + highlighted + display.slice(relativeCol + 1);
          } else if (relativeCol === effectiveWidth) {
            display = display.slice(0, effectiveWidth - 1) + chalk.inverse(" ");
          }
        }

        return <Text key={idx}>{display}</Text>;
      })}
    </Box>
  );
};

const MultilineTextEditor = React.forwardRef(MultilineTextEditorInner);

export default MultilineTextEditor;
