import type { ReviewDecision } from "../../utils/agent/review.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import { TerminalChatCommandReview } from "./terminal-chat-command-review.js";
import TerminalChatInputThinking from "./terminal-chat-input-thinking.js";
import { createInputItem } from "../../utils/input-utils.js";
import { setSessionId } from "../../utils/session.js";
import { clearTerminal, onExit } from "../../utils/terminal.js";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "../vendor/ink-select/select";
import TextInput from "../vendor/ink-text-input.js";
import { Box, Text, useApp, useInput } from "ink";
import { fileURLToPath } from "node:url";
import React, { useCallback, useState, useMemo, useEffect } from "react";
import { listAllFiles } from "../../utils/list-all-files.js";
import { getIgnoredFiles } from "../../utils/check-in-git.js";

const suggestions = [
  "explain this codebase to me",
  "fix any build errors",
  "are there any bugs in my code?",
];

const slashCommands = [
  { name: "/model", description: "switch model" },
  { name: "/clear", description: "clear context" },
  { name: "/history", description: "show current history" },
  { name: "/history restore", description: "restore a past session" },
  { name: "/memory", description: "manage project memory" },
  { name: "/memory maintain", description: "perform automated memory cleanup" },
  { name: "/approval", description: "change approval mode" },
  { name: "/config", description: "toggle dry-run/debug" },
  { name: "/index", description: "index codebase for semantic search" },
  { name: "/pin", description: "pin a file to the context" },
  { name: "/unpin", description: "unpin a file from the context" },
  { name: "/ignored", description: "show ignored files" },
  { name: "/recipes", description: "select a prompt template" },
  { name: "/prompt", description: "edit system instructions" },
  { name: "/prompts", description: "select from available system prompts" },
  { name: "/help", description: "show help" },
];

export default function TerminalChatInput({
  isNew,
  loading,
  submitInput,
  confirmationPrompt,
  submitConfirmation,
  setPrevItems,
  setItems,
  openOverlay,
  openHistorySelectOverlay,
  openModelOverlay,
  openApprovalOverlay,
  openMemoryOverlay,
  openHelpOverlay,
  openConfigOverlay,
  openPromptOverlay,
  openPromptsOverlay,
  openRecipesOverlay,
  onPin,
  onUnpin,
  interruptAgent,
  partialReasoning,
  active,
  allowAlwaysPatch,
  awaitingContinueConfirmation,
  activeToolName,
  activeToolArguments,
}: {
  isNew: boolean;
  loading: boolean;
  submitInput: (input: Array<ChatCompletionMessageParam>) => void;
  confirmationPrompt: React.ReactNode | null;
  submitConfirmation: (
    decision: ReviewDecision,
    customDenyMessage?: string,
  ) => void;
  setPrevItems: (prevItems: Array<ChatCompletionMessageParam>) => void;
  setItems: React.Dispatch<
    React.SetStateAction<Array<ChatCompletionMessageParam>>
  >;
  openOverlay: () => void;
  openHistorySelectOverlay: () => void;
  openModelOverlay: () => void;
  openApprovalOverlay: () => void;
  openMemoryOverlay: () => void;
  openHelpOverlay: () => void;
  openConfigOverlay: () => void;
  openPromptOverlay: () => void;
  openPromptsOverlay: () => void;
  openRecipesOverlay: () => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  interruptAgent: () => void;
  partialReasoning?: string;
  active: boolean;
  allowAlwaysPatch?: boolean;
  awaitingContinueConfirmation?: { type: "yes-no" } | { type: "choices"; choices: string[] } | null;
  activeToolName?: string;
  activeToolArguments?: Record<string, any>;
}) {
  const app = useApp();
  const [selectedSuggestion, setSelectedSuggestion] = useState<number>(0);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<number>(0);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Array<string>>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState<string>("");

  const [customInputMode, setCustomInputMode] = useState(false);

  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  useEffect(() => {
    if (active) {
      setAllFiles(listAllFiles());
    }
  }, [active]);

  const fileSearchMatch = useMemo(() => {
    const lastAt = input.lastIndexOf("@");
    if (lastAt === -1) return null;
    
    // Ensure it's either at the start or preceded by a space
    if (lastAt > 0 && input[lastAt - 1] !== " ") return null;

    const query = input.slice(lastAt + 1).split(" ")[0] || "";
    return { query, startIndex: lastAt };
  }, [input]);

  const filteredFiles = useMemo(() => {
    if (!fileSearchMatch) return [];
    const q = fileSearchMatch.query.toLowerCase();
    return allFiles
      .filter((f) => f.toLowerCase().includes(q))
      .sort((a, b) => {
        // Boost files that start with the query
        const aStart = a.toLowerCase().startsWith(q);
        const bStart = b.toLowerCase().startsWith(q);
        if (aStart && !bStart) return -1;
        if (!aStart && bStart) return 1;
        return a.localeCompare(b);
      })
      .slice(0, 10);
  }, [allFiles, fileSearchMatch]);

  const filteredSlashCommands = input.startsWith("/")
    ? slashCommands.filter((c) => c.name.startsWith(input))
    : [];

  const onKeyDown = (inputStr: string, key: any) => {
    if (filteredFiles.length > 0) {
      if (key.tab) {
        setSelectedFileIndex((s) => (s + (key.shift ? -1 : 1) + filteredFiles.length) % filteredFiles.length);
        return true;
      }
      if (key.return) {
        const file = filteredFiles[selectedFileIndex];
        if (file && fileSearchMatch) {
          const before = input.slice(0, fileSearchMatch.startIndex);
          const after = input.slice(fileSearchMatch.startIndex + 1 + fileSearchMatch.query.length);
          setInput(before + file + after);
          return true;
        }
      }
    }

    if (input.startsWith("/")) {
      if (key.tab) {
        if (filteredSlashCommands.length > 0) {
          setSelectedSlashCommand((s) => (s + (key.shift ? -1 : 1) + filteredSlashCommands.length) % filteredSlashCommands.length);
          return true;
        }
      } else if (key.return) {
        const cmd = filteredSlashCommands[selectedSlashCommand]?.name || "";
        if (cmd && input !== cmd) {
          setInput(cmd);
          setSelectedSlashCommand(0);
          return true; // prevent submit on first enter
        }
        // if input === cmd, we return false and let TextInput's onSubmit handle it
      }
    }
    return false;
  };

  useInput(
    (_input, _key) => {
      if (awaitingContinueConfirmation && active && !loading) {
        if (awaitingContinueConfirmation.type === "yes-no") {
          if (_input === "y") {
            const item = {
              role: "user" as const,
              content: [{ type: "text" as const, text: "Yes" }],
            };
            submitInput([item]);
            return;
          }
          if (_input === "n") {
            const item = {
              role: "user" as const,
              content: [{ type: "text" as const, text: "No" }],
            };
            submitInput([item]);
            return;
          }
        }
      }

      if (customInputMode) {
        if (_key.escape) {
          setCustomInputMode(false);
          return;
        }
      }

      if (!confirmationPrompt && !loading && !customInputMode) {
        if (_key.upArrow) {
          if (filteredFiles.length > 0) {
            setSelectedFileIndex((s) => (s - 1 + filteredFiles.length) % filteredFiles.length);
            return;
          }
          if (filteredSlashCommands.length > 0) {
            setSelectedSlashCommand((s) => (s - 1 + filteredSlashCommands.length) % filteredSlashCommands.length);
            return;
          }
          if (history.length > 0) {
            if (historyIndex == null) {
              setDraftInput(input);
            }

            let newIndex: number;
            if (historyIndex == null) {
              newIndex = history.length - 1;
            } else {
              newIndex = Math.max(0, historyIndex - 1);
            }
            setHistoryIndex(newIndex);
            setInput(history[newIndex] ?? "");
          }
          return;
        }

        if (_key.downArrow) {
          if (filteredFiles.length > 0) {
            setSelectedFileIndex((s) => (s + 1) % filteredFiles.length);
            return;
          }
          if (filteredSlashCommands.length > 0) {
            setSelectedSlashCommand((s) => (s + 1) % filteredSlashCommands.length);
            return;
          }
          if (historyIndex == null) {
            return;
          }

          const newIndex = historyIndex + 1;
          if (newIndex >= history.length) {
            setHistoryIndex(null);
            setInput(draftInput);
          } else {
            setHistoryIndex(newIndex);
            setInput(history[newIndex] ?? "");
          }
          return;
        }
      }

      if (input.trim() === "" && isNew) {
        if (_key.tab) {
          setSelectedSuggestion(
            (s) => (s + (_key.shift ? -1 : 1)) % (suggestions.length + 1),
          );
        } else if (selectedSuggestion && _key.return) {
          const suggestion = suggestions[selectedSuggestion - 1] || "";
          setInput("");
          setSelectedSuggestion(0);
          submitInput([
            {
              role: "user",
              content: [{ type: "text", text: suggestion }],
            },
          ]);
        }
      } else if (_input === "\u0003" || (_input === "c" && _key.ctrl)) {
        setTimeout(() => {
          app.exit();
          onExit();
          process.exit(0);
        }, 60);
      }
    },
    { isActive: active },
  );

  const onSubmit = useCallback(
    async (value: string) => {
      const inputValue = value.trim();
      if (!inputValue) {
        return;
      }

      if (inputValue === "/history") {
        setInput("");
        openOverlay();
        return;
      }

      if (inputValue === "/history restore") {
        setInput("");
        openHistorySelectOverlay();
        return;
      }

      if (inputValue === "/help") {
        setInput("");
        openHelpOverlay();
        return;
      }

      if (inputValue === "/memory") {
        setInput("");
        openMemoryOverlay();
        return;
      }

      if (inputValue === "/memory maintain") {
        setInput("");
        submitInput([
          {
            role: "user",
            content: [{ type: "text", text: "Please perform memory maintenance." }],
          },
        ]);
        return;
      }

      if (inputValue.startsWith("/model")) {
        setInput("");
        openModelOverlay();
        return;
      }

      if (inputValue.startsWith("/approval")) {
        setInput("");
        openApprovalOverlay();
        return;
      }

      if (inputValue.startsWith("/config")) {
        setInput("");
        openConfigOverlay();
        return;
      }

      if (inputValue.startsWith("/pin ")) {
        const path = inputValue.slice(5).trim();
        if (path) {
          onPin(path);
        }
        setInput("");
        return;
      }

      if (inputValue.startsWith("/unpin ")) {
        const path = inputValue.slice(7).trim();
        if (path) {
          onUnpin(path);
        }
        setInput("");
        return;
      }

      if (inputValue === "/ignored") {
        const ignored = getIgnoredFiles(process.cwd());
        setItems((prev) => [
          ...prev,
          {
            role: "assistant",
            content: ignored.length > 0 
              ? `Ignored files:\n${ignored.map(f => `- ${f}`).join("\n")}`
              : "No ignored files found.",
          },
        ]);
        setInput("");
        return;
      }

      if (inputValue === "/index") {
        setInput("");
        submitInput([
          {
            role: "user",
            content: [{ type: "text", text: "Please index the codebase for semantic search." }],
          },
        ]);
        return;
      }

      if (inputValue === "/prompt") {
        setInput("");
        openPromptOverlay();
        return;
      }

      if (inputValue === "/prompts") {
        setInput("");
        openPromptsOverlay();
        return;
      }

      if (inputValue === "/recipes") {
        setInput("");
        openRecipesOverlay();
        return;
      }

      if (inputValue === "q" || inputValue === ":q" || inputValue === "exit") {
        setInput("");
        // wait one 60ms frame
        setTimeout(() => {
          app.exit();
          onExit();
          process.exit(0);
        }, 60);
        return;
      } else if (inputValue === "/clear" || inputValue === "clear") {
        setInput("");
        setSessionId("");
        setPrevItems([]);
        clearTerminal();

        // Emit a system message to confirm the clear action.  We *append*
        // it so Ink's <Static> treats it as new output and actually renders it.
        setItems((prev) => [
          ...prev,
          {
            role: "assistant",
            content: [{ type: "text", text: "Context cleared" }],
          },
        ]);

        return;
      }

      // detect image file paths for dynamic inclusion
      const images: Array<string> = [];
      let text = inputValue;
      // markdown-style image syntax: ![alt](path)
      text = text.replace(/!\[[^\]]*?\]\(([^)]+)\)/g, (_m, p1: string) => {
        images.push(p1.startsWith("file://") ? fileURLToPath(p1) : p1);
        return "";
      });
      // quoted file paths ending with common image extensions (e.g. '/path/to/img.png')
      text = text.replace(
        /['"]([^'"]+?\.(?:png|jpe?g|gif|bmp|webp|svg))['"]/gi,
        (_m, p1: string) => {
          images.push(p1.startsWith("file://") ? fileURLToPath(p1) : p1);
          return "";
        },
      );
      // bare file paths ending with common image extensions
      text = text.replace(
        // eslint-disable-next-line no-useless-escape
        /\b(?:\.[\/\\]|[\/\\]|[A-Za-z]:[\/\\])?[\w-]+(?:[\/\\][\w-]+)*\.(?:png|jpe?g|gif|bmp|webp|svg)\b/gi,
        (match: string) => {
          images.push(
            match.startsWith("file://") ? fileURLToPath(match) : match,
          );
          return "";
        },
      );
      text = text.trim();

      const inputItem = await createInputItem(text, images);
      submitInput([inputItem]);
      setHistory((prev) => {
        if (prev[prev.length - 1] === value) {
          return prev;
        }
        return [...prev, value];
      });
      setHistoryIndex(null);
      setDraftInput("");
      setSelectedSuggestion(0);
      setInput("");
    },
    [
      setInput,
      submitInput,
      setPrevItems,
      setItems,
      app,
      setHistory,
      setHistoryIndex,
      openOverlay,
      openHistorySelectOverlay,
      openApprovalOverlay,
      openModelOverlay,
      openHelpOverlay,
      openConfigOverlay,
      openPromptOverlay,
      openPromptsOverlay,
    ],
  );

  if (confirmationPrompt) {
    return (
      <TerminalChatCommandReview
        confirmationPrompt={confirmationPrompt}
        onReviewCommand={submitConfirmation}
        allowAlwaysPatch={allowAlwaysPatch}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {awaitingContinueConfirmation && !customInputMode ? (
          <Box flexDirection="column">
            <Text>{awaitingContinueConfirmation.type === "yes-no" ? "Allow agent to proceed?" : "Select an option:"}</Text>
            <Box paddingX={2}>
              <Select
                options={
                  awaitingContinueConfirmation.type === "yes-no"
                    ? [
                        { label: "Yes (y)", value: "Yes" },
                        { label: "No (n)", value: "No" },
                        { label: "Custom...", value: "__custom__" },
                      ]
                    : [
                        ...awaitingContinueConfirmation.choices.map(c => ({ label: c, value: c })),
                        { label: "Custom...", value: "__custom__" }
                      ]
                }
                onChange={(value: string) => {
                  if (value === "__custom__") {
                    setCustomInputMode(true);
                    return;
                  }
                  const item = {
                    role: "user" as const,
                    content: [{ type: "text" as const, text: value }],
                  };
                  submitInput([item]);
                }}
              />
            </Box>
          </Box>
        ) : (
          <TextInput
            focus={active}
            placeholder={
              customInputMode
                ? "type your custom response..."
                : selectedSuggestion
                ? `"${suggestions[selectedSuggestion - 1]}"`
                : "send a message" +
                  (isNew ? " (tab for suggestions)" : "")
            }
            showCursor
            value={input}
            onKeyDown={onKeyDown}
            onChange={(value) => {
              setDraftInput(value);
              if (historyIndex != null) {
                setHistoryIndex(null);
              }
              setInput(value);
            }}
            onSubmit={(value) => {
              if (customInputMode) {
                setCustomInputMode(false);
              }
              onSubmit(value);
            }}
          />
        )}
      </Box>
      {filteredFiles.length > 0 && (
        <Box flexDirection="column" borderStyle="round" borderColor="magentaBright" paddingX={1} marginBottom={0} width={60}>
          <Box marginBottom={0} justifyContent="space-between">
            <Text bold color="magentaBright">File Autocomplete</Text>
            <Text dimColor>{filteredFiles.length} matches</Text>
          </Box>
          <Box flexDirection="column" marginTop={1}>
            {filteredFiles.map((f, i) => (
              <Box key={f} gap={2}>
                <Text color={i === selectedFileIndex ? "magentaBright" : "gray"} bold={i === selectedFileIndex}>
                  {i === selectedFileIndex ? "❯" : " "} {f}
                </Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1}>
            <Text dimColor>↑↓/Tab to navigate · Enter to select</Text>
          </Box>
        </Box>
      )}
      {filteredSlashCommands.length > 0 && input !== filteredSlashCommands[selectedSlashCommand]?.name && (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={0}>
          {filteredSlashCommands.map((cmd, i) => (
            <Box key={cmd.name} gap={2}>
              <Text color={i === selectedSlashCommand ? "cyan" : "gray"} bold={i === selectedSlashCommand}>
                {i === selectedSlashCommand ? "❯" : " "} {cmd.name.padEnd(10)}
              </Text>
              <Text dimColor={i !== selectedSlashCommand}>{cmd.description}</Text>
            </Box>
          ))}
        </Box>
      )}
      {loading && (
        <Box paddingLeft={1}>
          <TerminalChatInputThinking
            onInterrupt={interruptAgent}
            active={active}
            partialReasoning={partialReasoning}
            activeToolName={activeToolName}
            activeToolArguments={activeToolArguments}
          />
        </Box>
      )}
    </Box>
  );
}

