import MultilineTextEditor, { type MultilineTextEditorHandle } from "./chat/multiline-editor.js";
import { Box, Text, useInput } from "ink";
import React, { useRef } from "react";
import type { Theme } from "../utils/theme.js";

export default function SearchUrlOverlay({
  title,
  currentUrl,
  onSave,
  onExit,
  theme,
  onRefresh,
}: {
  title: string;
  currentUrl: string;
  onSave: (newUrl: string) => void;
  onExit: () => void;
  theme: Theme;
  onRefresh?: () => void;
}) {
  const editorRef = useRef<MultilineTextEditorHandle>(null);

  useInput((input, key) => {
    if (key.escape) {
      onExit();
    }
    if (key.return && !key.shift && !key.ctrl) {
        if (editorRef.current) {
            onSave(editorRef.current.getText().trim());
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
      width={80}
      marginY={1}
    >
      <Box paddingX={1} marginBottom={1} gap={1}>
        <Text bold color={theme.highlight} inverse paddingX={1}> SEARCH </Text>
        <Text color={theme.highlight} bold>{title}</Text>
      </Box>

      <Box 
        borderStyle="single" 
        padding={1} 
        borderColor={theme.divider}
        marginLeft={1}
      >
        <MultilineTextEditor
          ref={editorRef}
          initialText={currentUrl}
          height={1}
          onSubmit={(text) => onSave(text.trim())}
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
            enter SAVE │ esc CANCEL
        </Text>
        <Text dimColor size={0.8} marginTop={1}>
            Use %s as a placeholder for the search query.
        </Text>
      </Box>
    </Box>
  );
}
