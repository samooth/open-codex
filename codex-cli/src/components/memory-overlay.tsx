import { Box, Text, useInput } from "ink";
import React, { useMemo, useState, useEffect } from "react";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import TextInput from "./vendor/ink-text-input.js";
import type { Theme } from "../utils/theme.js";

type MemoryEntry = {
  timestamp: string;
  category: string;
  fact: string;
  raw: string;
};

type Props = {
  onExit: () => void;
  theme: Theme;
};

export default function MemoryOverlay({ onExit, theme }: Props): JSX.Element {
  const [entries, setEntries] = useState<Array<MemoryEntry>>([]);
  const [cursor, setCursor] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const memoryPath = useMemo(() => join(process.cwd(), ".codex", "memory.md"), []);

  const loadMemory = () => {
    if (!existsSync(memoryPath)) {
      setEntries([]);
      return;
    }
    try {
      const content = readFileSync(memoryPath, "utf-8");
      const lines = content.split("\n").filter(line => line.trim().startsWith("- ["));
      const parsed: Array<MemoryEntry> = lines.map(line => {
        const match = line.match(/- \[(.*?)\] \[(.*?)\] (.*)/);
        if (match) {
          return {
            timestamp: match[1] || "",
            category: match[2] || "",
            fact: match[3] || "",
            raw: line
          };
        }
        return { timestamp: "", category: "unknown", fact: line.replace("- ", ""), raw: line };
      });
      setEntries(parsed);
    } catch (err) {
      setEntries([]);
    }
  };

  useEffect(() => {
    loadMemory();
  }, []);

  const filteredEntries = useMemo(() => {
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(e => 
      e.fact.toLowerCase().includes(q) || 
      e.category.toLowerCase().includes(q)
    );
  }, [entries, searchQuery]);

  const deleteEntry = (index: number) => {
    const entryToDelete = filteredEntries[index];
    if (!entryToDelete) return;

    const nextEntries = entries.filter(e => e.raw !== entryToDelete.raw);
    try {
      const newContent = nextEntries.map(e => e.raw).join("\n");
      writeFileSync(memoryPath, newContent, "utf-8");
      setEntries(nextEntries);
      setCursor(c => Math.max(0, Math.min(nextEntries.length - 1, c)));
    } catch (err) {
      // ignore
    }
  };

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) setIsSearching(false);
      return;
    }

    if (key.escape) {
      onExit();
      return;
    }

    if (input === "/") {
      setIsSearching(true);
      return;
    }

    if (key.delete || key.backspace || input === "d") {
      deleteEntry(cursor);
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(filteredEntries.length - 1, c + 1));
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.pageDown) {
      setCursor((c) => Math.min(filteredEntries.length - 1, c + 10));
    } else if (key.pageUp) {
      setCursor((c) => Math.max(0, c - 10));
    } else if (input === "g") {
      setCursor(0);
    } else if (input === "G") {
      setCursor(filteredEntries.length - 1);
    }
  });

  const rows = process.stdout.rows || 24;
  const headerRows = 4;
  const footerRows = 2;
  const maxVisible = Math.max(4, rows - headerRows - footerRows);

  const firstVisible = Math.min(
    Math.max(0, cursor - Math.floor(maxVisible / 2)),
    Math.max(0, filteredEntries.length - maxVisible),
  );
  const visible = filteredEntries.slice(firstVisible, firstVisible + maxVisible);

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
      <Box paddingX={1} marginBottom={1} justifyContent="space-between" gap={1}>
        <Box gap={1}>
          <Text bold color={theme.highlight} inverse paddingX={1}> MEMORY </Text>
          <Text bold color={theme.highlight}>PROJECT KNOWLEDGE ({filteredEntries.length})</Text>
        </Box>
        {isSearching ? (
          <Box gap={1}>
            <Text color={theme.highlight} bold>SEARCH: </Text>
            <TextInput 
              value={searchQuery} 
              onChange={setSearchQuery} 
              onSubmit={() => setIsSearching(false)} 
            />
          </Box>
        ) : (
          <Text dimColor>Press <Text bold color={theme.highlight}>/</Text> to filter</Text>
        )}
      </Box>
      
      <Box flexDirection="column" paddingX={1} marginBottom={1} minHeight={4}>
        {visible.length === 0 ? (
          <Text color={theme.warning} italic>No memory entries found.</Text>
        ) : (
          visible.map((entry, idx) => {
            const absIdx = firstVisible + idx;
            const selected = absIdx === cursor;
            return (
              <Box key={absIdx} justifyContent="space-between">
                <Box gap={1}>
                  <Text color={selected ? theme.highlight : theme.dim} bold={selected}>
                    {selected ? "❯" : " "}
                  </Text>
                  <Box width={15}>
                    <Text color={theme.accent}>[{entry.category.toUpperCase()}]</Text>
                  </Box>
                  <Text color={selected ? theme.highlight : undefined}>{entry.fact}</Text>
                </Box>
                <Box>
                  <Text color={theme.dim} italic>[{entry.timestamp}]</Text>
                </Box>
              </Box>
            );
          })
        )}
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
          ↑↓ SCROLL │ / SEARCH │ d DELETE │ esc CLOSE
        </Text>
      </Box>
    </Box>
  );
}
