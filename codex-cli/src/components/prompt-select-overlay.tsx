import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";
import type { Theme } from "../utils/theme.js";

function findGitRoot(startDir: string): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, ".git"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  return null;
}

export default function PromptSelectOverlay({
  onSelect,
  onExit,
  theme,
}: {
  onSelect: (instructions: string, name: string) => void;
  onExit: () => void;
  theme: Theme;
}) {
  const [prompts, setPrompts] = useState<{ label: string; value: string }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cwd = process.cwd();
    const gitRoot = findGitRoot(cwd);
    
    const promptDirs = [
      join(cwd, "prompts"),
      join(cwd, ".prompts"),
      join(cwd, ".codex", "prompts"),
    ];

    if (gitRoot && gitRoot !== cwd) {
      promptDirs.push(join(gitRoot, "prompts"));
      promptDirs.push(join(gitRoot, ".prompts"));
      promptDirs.push(join(gitRoot, ".codex", "prompts"));
    }

    promptDirs.push(join(homedir(), ".codex", "prompts"));

    // De-duplicate paths
    const uniqueDirs = Array.from(new Set(promptDirs));
    const allPrompts: { label: string; value: string; path: string }[] = [];

    for (const dir of uniqueDirs) {
      if (existsSync(dir)) {
        try {
          const files = readdirSync(dir);
          for (const file of files) {
            if (file.endsWith(".md") || file.endsWith(".txt")) {
              if (!allPrompts.find(p => p.label === file)) {
                allPrompts.push({
                  label: file,
                  value: file,
                  path: join(dir, file),
                });
              }
            }
          }
        } catch (e) {
          // ignore
        }
      }
    }

    setPrompts(allPrompts);
    setLoading(false);
  }, []);

  useInput((_input, key) => {
    if (key.escape) {
      onExit();
    }
  });

  const handleSelect = (item: { label: string; value: string; path: string }) => {
    try {
      const content = readFileSync(item.path, "utf-8");
      onSelect(content, item.label);
    } catch (e) {
      // ignore
    }
  };

  if (loading) {
    return (
      <Box paddingLeft={1} borderStyle="bold" borderRight={false} borderTop={false} borderBottom={false} borderLeftColor={theme.highlight} marginY={1}>
        <Text italic color={theme.dim}>LOADING PROMPT LIBRARY...</Text>
      </Box>
    );
  }

  if (prompts.length === 0) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={1}
        borderStyle="bold"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderLeftColor={theme.error}
        width={80}
        marginY={1}
      >
        <Box marginBottom={1} gap={1}>
          <Text bold color={theme.error} inverse paddingX={1}> EMPTY </Text>
          <Text bold color={theme.error}>NO PROMPT FILES FOUND</Text>
        </Box>
        <Box paddingX={1}>
          <Text color={theme.dim}>Searched in: ./prompts, ./.codex/prompts, and ~/.codex/prompts</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Press esc to cancel</Text>
        </Box>
      </Box>
    );
  }

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
        <Text bold color={theme.highlight} inverse paddingX={1}> LIBRARY </Text>
        <Text color={theme.highlight} bold>SELECT SYSTEM PROMPT</Text>
      </Box>

      <Box paddingX={1} marginBottom={1}>
        <Select
          options={prompts}
          onChange={(value: string) => {
            const selected = (prompts as any).find((p: any) => p.value === value);
            if (selected) {
                handleSelect(selected);
            }
          }}
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
      >
        <Text dimColor italic>
          ↑↓ navigate │ enter confirm │ esc close
        </Text>
      </Box>
    </Box>
  );
}
