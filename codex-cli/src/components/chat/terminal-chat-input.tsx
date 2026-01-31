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
import React, { useCallback, useState, Fragment } from "react";

const suggestions = [
  "explain this codebase to me",
  "fix any build errors",
  "are there any bugs in my code?",
];

const slashCommands = [
  { name: "/model", description: "switch model" },
  { name: "/clear", description: "clear context" },
  { name: "/history", description: "show history" },
  { name: "/approval", description: "change approval mode" },
  { name: "/config", description: "toggle dry-run/debug" },
  { name: "/prompt", description: "edit system instructions" },
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
  setActiveFiles,
  contextLeftPercent,
  openOverlay,
  openModelOverlay,
  openApprovalOverlay,
  openHelpOverlay,
  openConfigOverlay,
  openPromptOverlay,
  interruptAgent,
  partialReasoning,
  active,
  allowAlwaysPatch,
  awaitingContinueConfirmation,
  queuedPromptsCount,
  activeFiles,
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
  setActiveFiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  contextLeftPercent: number;
  openOverlay: () => void;
  openModelOverlay: () => void;
  openApprovalOverlay: () => void;
  openHelpOverlay: () => void;
  openConfigOverlay: () => void;
  openPromptOverlay: () => void;
  interruptAgent: () => void;
  partialReasoning?: string;
  active: boolean;
  allowAlwaysPatch?: boolean;
  awaitingContinueConfirmation?: boolean;
  queuedPromptsCount: number;
  activeFiles: Set<string>;
  activeToolName?: string;
  activeToolArguments?: Record<string, any>;
}): React.ReactElement {
  const app = useApp();
  const [selectedSuggestion, setSelectedSuggestion] = useState<number>(0);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<number>(0);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Array<string>>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState<string>("");

  const filteredSlashCommands = input.startsWith("/")
    ? slashCommands.filter((c) => c.name.startsWith(input))
    : [];

  useInput(
    (_input, _key) => {
      if (awaitingContinueConfirmation && active && !loading) {
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

      if (!confirmationPrompt && !loading) {
        if (_key.upArrow) {
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

      if (input.startsWith("/")) {
        if (_key.tab) {
          setSelectedSlashCommand((s) => (s + (_key.shift ? -1 : 1) + filteredSlashCommands.length) % filteredSlashCommands.length);
        } else if (_key.return && filteredSlashCommands.length > 0) {
          const cmd = filteredSlashCommands[selectedSlashCommand]?.name || "";
          setInput(cmd);
          setSelectedSlashCommand(0);
          // We don't submit immediately to allow the user to see the full command or add args
        }
      } else if (input.trim() === "" && isNew) {
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

      if (inputValue === "/help") {
        setInput("");
        openHelpOverlay();
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

      if (inputValue.startsWith("/prompt")) {
        setInput("");
        openPromptOverlay();
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
        setActiveFiles(new Set());
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
      openApprovalOverlay,
      openModelOverlay,
      openHelpOverlay,
      openConfigOverlay,
      openPromptOverlay,
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
      <Box borderStyle="round">
        {awaitingContinueConfirmation ? (
          <Box paddingX={1} flexDirection="column">
            <Text>Allow agent to proceed?</Text>
            <Box paddingX={2}>
              <Select
                options={[
                  { label: "Yes (y)", value: "Yes" },
                  { label: "No (n)", value: "No" },
                ]}
                onChange={(value: string) => {
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
          <Box paddingX={1}>
            <TextInput
              focus={active}
              placeholder={
                selectedSuggestion
                  ? `"${suggestions[selectedSuggestion - 1]}"`
                  : "send a message" +
                    (isNew ? " or press tab to select a suggestion" : "")
              }
              showCursor
              value={input}
              onChange={(value) => {
                setDraftInput(value);
                if (historyIndex != null) {
                  setHistoryIndex(null);
                }
                setInput(value);
              }}
              onSubmit={onSubmit}
            />
          </Box>
        )}
      </Box>
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
        <Box borderStyle="round" borderColor="dimGray" paddingLeft={1}>
          <TerminalChatInputThinking
            onInterrupt={interruptAgent}
            active={active}
            partialReasoning={partialReasoning}
            activeToolName={activeToolName}
            activeToolArguments={activeToolArguments}
          />
        </Box>
      )}
      <Box paddingX={2} marginBottom={1} flexDirection="column">
        {activeFiles.size > 0 && (
          <Box marginBottom={0}>
            <Text dimColor>Files in context: </Text>
            <Text color="cyan" wrap="truncate">
              {Array.from(activeFiles).join(", ")}
            </Text>
          </Box>
        )}
        <Box>
          <Text dimColor>
            {isNew && !input ? (
              <>
                try:{" "}
                {suggestions.map((m, key) => (
                  <Fragment key={key}>
                    {key !== 0 ? " | " : ""}
                    <Text
                      backgroundColor={
                        key + 1 === selectedSuggestion ? "blackBright" : ""
                      }
                    >
                      {m}
                    </Text>
                  </Fragment>
                ))}
              </>
            ) : (
              <>
                send q or ctrl+c to exit | send "/clear" to reset | send "/help"
                for commands | press enter to send
              </>
            )}
          </Text>
          <Box marginLeft="auto" gap={1}>
            <Text dimColor>context: </Text>
            <Text color={contextLeftPercent < 10 ? "red" : contextLeftPercent < 25 ? "yellow" : "green"}>
              {"[".padEnd(1 + Math.round((100 - contextLeftPercent) / 10), "■").padEnd(11, " ").concat("]")}
              {` ${Math.round(100 - contextLeftPercent)}%`}
            </Text>
            {queuedPromptsCount > 0 && (
              <Text color="yellow">
                {` | ${queuedPromptsCount} prompt(s) queued`}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

