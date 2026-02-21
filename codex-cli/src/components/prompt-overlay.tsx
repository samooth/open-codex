import MultilineTextEditor, { type MultilineTextEditorHandle } from "./chat/multiline-editor.js";
import { Box, Text, useInput } from "ink";
import React, { useRef } from "react";
import type { Theme } from "../utils/theme.js";

export default function PromptOverlay({
  currentInstructions,
  onSave,
  onExit,
  theme,
  onRefresh,
}: {
  currentInstructions: string;
  onSave: (newInstructions: string) => void;
  onExit: () => void;
  theme: Theme;
  onRefresh?: () => void;
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
    <Box
      flexDirection="column"
      paddingLeft={1}
      borderStyle="bold"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      width={100}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Text bold color={theme.highlight} inverse paddingX={1}> PROMPT </Text>
        <Text color={theme.highlight} bold>EDIT SYSTEM INSTRUCTIONS</Text>
      </Box>

      <Box 
        borderStyle="single" 
        padding={1} 
        borderColor={theme.divider}
        marginLeft={1}
      >
        <MultilineTextEditor
          ref={editorRef}
          initialText={currentInstructions}
          height={15}
          onRefresh={onRefresh}
        />
      </Box>

      <Box 
        borderStyle="single" 
        borderRight={false} 
        borderTop={true} 
        borderBottom={false} 
        borderLeft={false}
        borderTopColor={theme.divider}
        paddingX={1}
        paddingTop={1}
        marginTop={1}
      >
        <Text dimColor italic>
            enter NEWLINE │ ctrl+s SAVE │ esc CANCEL
        </Text>
      </Box>
    </Box>
  );
}
