import { Box, Text, useInput } from "ink";
import React, { useEffect, useState } from "react";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "./vendor/ink-select/select.js";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { homedir } from "os";

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
}: {
  onSelect: (instructions: string, name: string) => void;
  onExit: () => void;
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
              // Avoid duplicates if the same filename exists in multiple searched dirs
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
      <Box borderStyle="round" borderColor="blue" paddingX={1}>
        <Text italic>Loading prompts...</Text>
      </Box>
    );
  }

  if (prompts.length === 0) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Select System Prompt</Text>
        </Box>
        <Text color="red">No prompts found in ./prompts, ./.codex/prompts, or ~/.codex/prompts</Text>
        <Box marginTop={1}>
          <Text dimColor>Press Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="blue" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Select System Prompt</Text>
      </Box>
      <Box borderStyle="single" paddingX={1}>
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
      <Box marginTop={1}>
        <Text dimColor>
          Use arrow keys to select • Press <Text bold>Enter</Text> to confirm • <Text bold>Esc</Text> to cancel
        </Text>
      </Box>
    </Box>
  );
}
