import { Box, Text, useInput } from "ink";
import React, { useMemo, useState, useEffect } from "react";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import TextInput from "./vendor/ink-text-input.js";

type MemoryEntry = {
  timestamp: string;
  category: string;
  fact: string;
  raw: string;
};

type Props = {
  onExit: () => void;
};

export default function MemoryOverlay({ onExit }: Props): JSX.Element {
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
    if (isSearching) return;

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
      borderStyle="round"
      borderColor="magenta"
      width={100}
    >
      <Box paddingX={1} flexDirection="column">
        <Text bold color="magenta">Project Memory ({filteredEntries.length})</Text>
        {isSearching ? (
          <Box>
            <Text color="cyan">Search: </Text>
            <TextInput 
              value={searchQuery} 
              onChange={setSearchQuery} 
              onSubmit={() => setIsSearching(false)} 
            />
          </Box>
        ) : (
          searchQuery && <Text dimColor italic>Filtering for: {searchQuery} (press / to change)</Text>
        )}
      </Box>
      
      <Box flexDirection="column" paddingX={1} marginTop={1}>
        {visible.length === 0 ? (
          <Text dimColor>No memory entries found.</Text>
        ) : (
          visible.map((entry, idx) => {
            const absIdx = firstVisible + idx;
            const selected = absIdx === cursor;
            return (
              <Box key={absIdx}>
                <Text color={selected ? "cyan" : undefined}>
                  {selected ? "› " : "  "}
                </Text>
                <Box width={15}>
                  <Text color="blue">[{entry.category}]</Text>
                </Box>
                <Text color={selected ? "white" : "gray"}>{entry.fact}</Text>
                <Box marginLeft="auto">
                  <Text dimColor>[{entry.timestamp}]</Text>
                </Box>
              </Box>
            );
          })
        )}
      </Box>

      <Box paddingX={1} marginTop={1} flexDirection="column" borderStyle="single" borderColor="dimGray">
        <Text dimColor>
          esc Close | ↑↓ Scroll | / Search | d/Del Delete entry | g/G Start/End
        </Text>
      </Box>
    </Box>
  );
}
