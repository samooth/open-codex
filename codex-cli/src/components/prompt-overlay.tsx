import MultilineTextEditor, { type MultilineTextEditorHandle } from "./chat/multiline-editor.js";
import { Box, Text, useInput } from "ink";
import React, { useRef } from "react";

export default function PromptOverlay({
  currentInstructions,
  onSave,
  onExit,
}: {
  currentInstructions: string;
  onSave: (newInstructions: string) => void;
  onExit: () => void;
}) {
  const editorRef = useRef<MultilineTextEditorHandle>(null);

  useInput((input, key) => {
    if (key.escape) {
      onExit();
    }
    // Ctrl+S to save
    if ((key.ctrl && input === "s") || input === "\x13") {
        if (editorRef.current) {
            onSave(editorRef.current.getText());
        }
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Edit System Prompt</Text>
      </Box>
      <Box borderStyle="single" padding={1}>
        <MultilineTextEditor
          ref={editorRef}
          initialText={currentInstructions}
          height={15}
        />
      </Box>
      <Box marginTop={1}>
        <Text dimColor>
            Press <Text bold>Enter</Text> for newline • <Text bold>Ctrl+S</Text> to save • <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}
