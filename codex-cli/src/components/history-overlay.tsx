import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { Box, Text, useInput } from "ink";
import React, { useMemo, useState } from "react";
import TextInput from "./vendor/ink-text-input.js";
import type { Theme } from "../utils/theme.js";

type Props = {
  items: Array<ChatCompletionMessageParam>;
  onExit: () => void;
  theme: Theme;
};

type Mode = "commands" | "files";

export default function HistoryOverlay({ items, onExit, theme }: Props): JSX.Element {
  const [mode, setMode] = useState<Mode>("commands");
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const { commands, files } = useMemo(() => buildLists(items), [items]);

  const rawList = mode === "commands" ? commands : files;
  const list = useMemo(() => {
    if (!filter) return rawList;
    const f = filter.toLowerCase();
    return rawList.filter((item) => item.toLowerCase().includes(f));
  }, [rawList, filter]);

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        return;
      }
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

    if (input === "c") {
      setMode("commands");
      setCursor(0);
      setFilter("");
      return;
    }
    if (input === "f") {
      setMode("files");
      setCursor(0);
      setFilter("");
      return;
    }

    if (key.downArrow || input === "j") {
      setCursor((c) => Math.min(list.length - 1, c + 1));
    } else if (key.upArrow || input === "k") {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.pageDown) {
      setCursor((c) => Math.min(list.length - 1, c + 10));
    } else if (key.pageUp) {
      setCursor((c) => Math.max(0, c - 10));
    } else if (input === "g") {
      setCursor(0);
    } else if (input === "G") {
      setCursor(list.length - 1);
    }
  });

  const rows = process.stdout.rows || 24;
  const headerRows = 4;
  const footerRows = 2;
  const maxVisible = Math.max(4, rows - headerRows - footerRows);

  const firstVisible = Math.min(
    Math.max(0, cursor - Math.floor(maxVisible / 2)),
    Math.max(0, list.length - maxVisible),
  );
  const visible = list.slice(firstVisible, firstVisible + maxVisible);

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
          <Text bold color={theme.highlight} inverse paddingX={1}> HISTORY </Text>
          <Text bold color={theme.highlight}>
            {mode === "commands" ? "COMMANDS RUN" : "FILES TOUCHED"} ({list.length})
          </Text>
        </Box>
        {isSearching ? (
          <Box gap={1}>
            <Text color={theme.highlight} bold>SEARCH: </Text>
            <TextInput
              value={filter}
              onChange={(val) => {
                setFilter(val);
                setCursor(0);
              }}
              onSubmit={() => setIsSearching(false)}
            />
          </Box>
        ) : (
          <Text dimColor>Press <Text bold color={theme.highlight}>/</Text> to filter</Text>
        )}
      </Box>

      <Box flexDirection="column" paddingX={1} marginBottom={1} minHeight={4}>
        {list.length > 0 ? (
          visible.map((txt, idx) => {
            const absIdx = firstVisible + idx;
            const selected = absIdx === cursor;
            return (
              <Box key={absIdx} gap={1}>
                <Text color={selected ? theme.highlight : theme.dim} bold={selected}>
                  {selected ? "❯" : " "}
                </Text>
                <Text color={selected ? theme.highlight : undefined} wrap="truncate-end">
                  {txt}
                </Text>
              </Box>
            );
          })
        ) : (
          <Box paddingLeft={2}>
            <Text color={theme.warning} italic>No entries matching filter.</Text>
          </Box>
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
        <Text dimColor>
          c COMMANDS │ f FILES │ ↑↓ SCROLL │ / SEARCH │ esc CLOSE
        </Text>
      </Box>
    </Box>
  );
}

function buildLists(items: Array<ChatCompletionMessageParam>): {
  commands: Array<string>;
  files: Array<string>;
} {
  const commands: Array<string> = [];
  const filesSet = new Set<string>();

  for (const item of items) {
    if (item.role === "user") {
      // TODO: We're ignoring images/files here.
      const texts: Array<string> = [];
      if (typeof item.content === "string") {
        texts.push(item.content);
      } else if (Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part.type === "text") {
            texts.push(part.text);
          }
        }
      }
      if (texts.length > 0) {
        const fullPrompt = texts.join(" ");
        // Truncate very long prompts so the history view stays legible.
        const truncated =
          fullPrompt.length > 120 ? `${fullPrompt.slice(0, 117)}…` : fullPrompt;
        commands.push(`> ${truncated}`);
      }

      continue;
    }

    // ------------------------------------------------------------------
    // We are interested in tool calls.
    if ("tool_calls" in item && item.tool_calls) {
      for (const toolCall of item.tool_calls) {
        if (toolCall.type !== "function") continue;

        const toolName = toolCall.function.name;
        const argsString = toolCall.function.arguments;

        if (!argsString) {
          commands.push(toolName);
          continue;
        }

        let argsJson: any = {};
        try {
          argsJson = JSON.parse(argsString);
        } catch {
          commands.push(toolName);
          continue;
        }

        const cmdArray: Array<string> | undefined = Array.isArray(argsJson?.cmd)
          ? argsJson.cmd
          : Array.isArray(argsJson?.command)
          ? argsJson.command
          : undefined;

        if (cmdArray && cmdArray.length > 0) {
          commands.push(cmdArray.join(" "));

          for (const part of cmdArray) {
            if (!part.startsWith("-") && (part.includes("/") || part.includes("."))) {
              if (part.length > 2) filesSet.add(part);
            }
          }

          if (cmdArray[0] === "apply_patch" || toolName === "apply_patch") {
            const patchText = argsJson.patch || cmdArray.find(s => s.includes("*** Begin Patch"));
            if (typeof patchText === "string") {
              const lines = patchText.split("\n");
              for (const line of lines) {
                const m = line.match(/^[-+]{3} [ab]\/(.+)$/);
                if (m && m[1]) {
                  filesSet.add(m[1]);
                }
              }
            }
          }
          continue;
        }

        // Generic tool call summary
        let summary = toolName;
        const interestingKeys = ["path", "file", "filepath", "filename", "pattern", "query", "url"];
        for (const key of interestingKeys) {
          const val = argsJson[key];
          if (typeof val === "string") {
            summary += ` ${val}`;
            if (val.includes("/") || val.includes(".")) {
               if (val.length > 2) filesSet.add(val);
            }
            break;
          }
        }
        commands.push(summary);
      }
    }
  }

  return { commands, files: Array.from(filesSet).sort() };
}
