import type { Theme } from "../../utils/theme.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import MultilineTextEditor, {
  type MultilineTextEditorHandle,
} from "./multiline-editor.js";
import TerminalChatInputThinking from "./terminal-chat-input-thinking.js";
import { getFileSearchMatch, filterFiles } from "../../utils/autocomplete.js";
import { useAppContext } from "../../contexts/app-context.js";
import { getIgnoredFiles } from "../../utils/check-in-git.js";
import {
  createInputItem,
  openExternalEditor,
} from "../../utils/input-utils.js";
import { setSessionId } from "../../utils/session.js";
import { clearTerminal, onExit } from "../../utils/terminal.js";
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "../vendor/ink-select/select";
import { Box, Text, useApp, useInput } from "ink";
import { fileURLToPath } from "node:url";
import React, {
  useCallback,
  useState,
  useMemo,
  useEffect,
  Fragment,
} from "react";
import { useInterval } from "use-interval";

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
  { name: "/theme", description: "change UI theme" },
  { name: "/undo", description: "revert last turn and file changes" },
  { name: "/help", description: "show help" },
];

const typeHelpText = `ctrl+c exit | "/help" help | ↑↓ history | ctrl+x edit | ctrl+j \n | enter send | ctrl+f focus shell`;


export default function TerminalChatInput({
  isNew,
  loading,
  submitInput,
  confirmationPrompt,
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
  openCommandPalette,
  openCommandHistory,
  onPin,
  onUnpin,
  onUndo,
  onRefresh,
  onShellFocus,
  onCopy,
  interruptAgent,
  partialReasoning,
  activeBlockType,
  active,
  awaitingContinueConfirmation,
  activeToolName,
  activeToolArguments,
  theme,
  allFiles,
  isStreamingResponse,
  queuedInputText,
  onPopQueuedInput,
  contextLeftPercent,
  isShellFocused,
}: {
  isNew: boolean;
  loading: boolean;
  submitInput: (input: Array<ChatCompletionMessageParam>) => void;
  confirmationPrompt: React.ReactNode | null;
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
  openCommandPalette?: () => void;
  openCommandHistory?: () => void;
  openThemeOverlay: () => void;
  onPin: (path: string) => void;
  onUnpin: (path: string) => void;
  onUndo: () => void;
  onRefresh?: () => void;
  onShellFocus?: (isFocused: boolean) => void;
  onCopy?: () => void;
  interruptAgent: () => void;
  partialReasoning?: string;
  activeBlockType?: "thought" | "think" | "plan";
  active: boolean;
  awaitingContinueConfirmation?:
    | { type: "yes-no" }
    | { type: "choices"; choices: Array<string> }
    | null;
  activeToolName?: string;
  activeToolArguments?: Record<string, any>;
  theme: Theme;
  allFiles: Array<string>;
  isStreamingResponse?: boolean;
  queuedInputText?: string;
  onPopQueuedInput?: () => string;
  contextLeftPercent: number;
  isShellFocused?: boolean;
}) {
  const app = useApp();
  const { config } = useAppContext();
  const [selectedSuggestion, setSelectedSuggestion] = useState<number>(0);
  const [selectedSlashCommand, setSelectedSlashCommand] = useState<number>(0);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<Array<string>>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draftInput, setDraftInput] = useState<string>("");

  const [editorKey, setEditorKey] = useState(0);
  const editorRef = React.useRef<MultilineTextEditorHandle | null>(null);
  const prevCursorRow = React.useRef<number | null>(null);

  const wasActive = React.useRef(active);
  useEffect(() => {
    // When the component becomes active after being inactive, force a refresh
    // to clear any potential UI artifacts from overlays.
    if (active && !wasActive.current && onRefresh) {
      clearTerminal();
      onRefresh();
    }
    wasActive.current = active;
  }, [active, onRefresh]);

  const [customInputMode, setCustomInputMode] = useState(false);
  const [pulse, setPulse] = useState(false);

  useInterval(
    () => {
      setPulse((p) => !p);
    },
    active && !loading ? 800 : null,
  );

  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  const fileSearchMatch = useMemo(() => {
    return getFileSearchMatch(input);
  }, [input]);

  const filteredFiles = useMemo(() => {
    if (!fileSearchMatch) {
      return [];
    }
    return filterFiles(allFiles, fileSearchMatch.query);
  }, [allFiles, fileSearchMatch]);

  const filteredSlashCommands = useMemo(() => {
    return input.startsWith("/")
      ? slashCommands.filter((c) => c.name.startsWith(input))
      : [];
  }, [input]);

  useEffect(() => {
    setSelectedFileIndex(0);
  }, [filteredFiles.length]);

  useEffect(() => {
    setSelectedSlashCommand(0);
  }, [filteredSlashCommands.length]);

  const onKeyDown = (_inputStr: string, key: any) => {
    if (
      _inputStr === "" &&
      key.upArrow &&
      queuedInputText &&
      onPopQueuedInput
    ) {
      const poppedText = onPopQueuedInput();
      setInput(poppedText);
      return true;
    }

    if (filteredFiles.length > 0) {
      if (
        key.tab ||
        key.downArrow ||
        key.upArrow ||
        _inputStr === "j" ||
        _inputStr === "k"
      ) {
        setSelectedFileIndex((s) => {
          const delta =
            key.upArrow || (key.tab && key.shift) || _inputStr === "k" ? -1 : 1;
          return (s + delta + filteredFiles.length) % filteredFiles.length;
        });
        return true;
      }
      if (key.return) {
        const file = filteredFiles[selectedFileIndex];
        if (file && fileSearchMatch) {
          const before = input.slice(0, fileSearchMatch.startIndex);
          const after = input.slice(
            fileSearchMatch.startIndex + 1 + fileSearchMatch.query.length,
          );
          setInput(before + "@" + file + after);
          return true;
        }
      }
    }

    if (input.startsWith("/")) {
      if (
        key.tab ||
        key.downArrow ||
        key.upArrow ||
        _inputStr === "j" ||
        _inputStr === "k"
      ) {
        if (filteredSlashCommands.length > 0) {
          setSelectedSlashCommand((s) => {
            const delta =
              key.upArrow || (key.tab && key.shift) || _inputStr === "k"
                ? -1
                : 1;
            return (
              (s + delta + filteredSlashCommands.length) %
              filteredSlashCommands.length
            );
          });
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
      if (_key.escape && !customInputMode && !awaitingContinueConfirmation) {
        // If nothing else handles ESC, we just ignore it to prevent it from leaking into buffer
        return;
      }

      if (
        awaitingContinueConfirmation &&
        active &&
        !loading &&
        !customInputMode
      ) {
        if (_key.escape) {
          setCustomInputMode(true);
          return;
        }

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
          if (filteredFiles.length > 0 || filteredSlashCommands.length > 0) {
            // Handled in onKeyDown
            return;
          }

          if (input === "" && queuedInputText && onPopQueuedInput) {
            const poppedText = onPopQueuedInput();
            setInput(poppedText);
            return;
          }

          const cursorRow = editorRef.current?.getRow?.() ?? 0;
          const wasAtFirstRow = (prevCursorRow.current ?? cursorRow) === 0;

          if (history.length > 0 && wasAtFirstRow) {
            if (historyIndex == null) {
              const currentDraft = editorRef.current?.getText?.() ?? input;
              setDraftInput(currentDraft);
            }

            let newIndex: number;
            if (historyIndex == null) {
              newIndex = history.length - 1;
            } else {
              newIndex = Math.max(0, historyIndex - 1);
            }
            setHistoryIndex(newIndex);
            setInput(history[newIndex] ?? "");
            setEditorKey((k) => k + 1);
            return;
          }
        }

        if (_key.downArrow) {
          if (filteredFiles.length > 0 || filteredSlashCommands.length > 0) {
            // Handled in onKeyDown
            return;
          }

          if (
            historyIndex != null &&
            (editorRef.current?.isCursorAtLastRow() ?? true)
          ) {
            const newIndex = historyIndex + 1;
            if (newIndex >= history.length) {
              setHistoryIndex(null);
              setInput(draftInput);
              setEditorKey((k) => k + 1);
            } else {
              setHistoryIndex(newIndex);
              setInput(history[newIndex] ?? "");
              setEditorKey((k) => k + 1);
            }
            return;
          }
        }

        const cursorRow = editorRef.current?.getRow?.() ?? 0;
        // @ts-ignore - wasAtFirstRow is currently unused but kept for parity with up-arrow logic
        const wasAtFirstRow = (prevCursorRow.current ?? cursorRow) === 0;
        // (Removed 'j'/'k' history navigation logic that was previously here)
      }

      if (_key.ctrl && _input === "x") {
        const newContent = openExternalEditor(input, config);

        // Always clear and refresh to restore terminal state
        clearTerminal();
        onRefresh?.();

        if (newContent && newContent !== input) {
          setInput(newContent);
        }
        return;
      }

      if (_key.ctrl && _input === "y" && onCopy) {
        onCopy();
        return;
      }

      if (_key.ctrl && _input === "p" && openCommandPalette) {
        openCommandPalette();
        return;
      }

      if (_key.ctrl && _input === "r" && openCommandHistory) {
        openCommandHistory();
        return;
      }

      if (_key.ctrl && _input === "f" && loading) {
        onShellFocus?.(!isShellFocused);
        return;
      }

      if (input.trim() === "" && isNew) {
        if (_key.tab) {
          setSelectedSuggestion(
            (s) => (s + (_key.shift ? -1 : 1)) % (suggestions.length + 1),
          );
        } else if (selectedSuggestion > 0 && _key.return) {
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

      // Update the cached cursor position *after* we've potentially handled
      // the key so that the next event has the correct "previous" reference.
      prevCursorRow.current = editorRef.current?.getRow?.() ?? null;
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

      if (inputValue === "/undo") {
        setInput("");
        onUndo();
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
            content: [
              { type: "text", text: "Please perform memory maintenance." },
            ],
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
            content:
              ignored.length > 0
                ? `Ignored files:\n${ignored.map((f) => `- ${f}`).join("\n")}`
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
            content: [
              {
                type: "text",
                text: "Please index the codebase for semantic search.",
              },
            ],
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

      if (inputValue === "/theme") {
        setInput("");
        openOverlay();
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
        onRefresh?.();

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

      // Clean up the '@' prefix from highlighted files before submission
      text = text.replace(/@([\w\/\.-]+\.\w+)/g, "$1");

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
      onUndo,
      onPin,
      onUnpin,
      onRefresh,
    ],
  );

  if (confirmationPrompt) {
    return (
      <Box flexDirection="column">
        <Box
          borderStyle="single"
          borderColor={theme.dim}
          paddingX={1}
          height={3}
          justifyContent="center"
        >
          <Text dimColor italic>
            Waiting for approval above...
          </Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1} paddingX={1}>
      <Box
        flexDirection="row"
        gap={1}
        paddingX={1}
        borderStyle="bold"
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderLeftColor={active ? theme.highlight : theme.dim}
      >
        <Text
          color={active ? (pulse ? theme.highlight : theme.dim) : theme.dim}
          bold
        >
          {customInputMode ? "?" : "❯"}
        </Text>
        {awaitingContinueConfirmation && !customInputMode ? (
          <Box flexDirection="row" gap={2}>
            <Text color={theme.dim}>
              {awaitingContinueConfirmation.type === "yes-no"
                ? "Allow agent to proceed?"
                : "Select an option:"}
            </Text>
            <Box>
              <Select
                theme={theme}
                options={
                  awaitingContinueConfirmation.type === "yes-no"
                    ? [
                        { label: "Yes (y)", value: "Yes" },
                        { label: "No (n)", value: "No" },
                        { label: "Custom...", value: "__custom__" },
                      ]
                    : [
                        ...awaitingContinueConfirmation.choices.map((c) => ({
                          label: c,
                          value: c,
                        })),
                        { label: "Custom...", value: "__custom__" },
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
          <Box flexGrow={1} flexDirection="row" gap={1}>
            <Box flexGrow={1}>
              <MultilineTextEditor
                ref={editorRef}
                onChange={(txt: string) => setInput(txt)}
                key={editorKey}
                initialText={input}
                height={3}
                focus={active}
                onKeyDown={onKeyDown}
                editor={config?.editorCommand}
                onRefresh={onRefresh}
                onSubmit={(txt) => {
                  if (customInputMode) {
                    setCustomInputMode(false);
                  }
                  onSubmit(txt);

                  setEditorKey((k) => k + 1);
                  setInput("");
                  setHistoryIndex(null);
                  setDraftInput("");
                }}
              />
            </Box>
            {isShellFocused && (
              <Box
                backgroundColor={theme.warning as any}
                paddingX={1}
                height={1}
              >
                <Text bold color="black">
                  SHELL FOCUS ACTIVE
                </Text>
              </Box>
            )}
          </Box>
        )}
      </Box>

      <Box paddingX={2} marginTop={1}>
        <Text dimColor>
          {!input && isNew ? (
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
              {typeHelpText}
              {contextLeftPercent < 25 && (
                <>
                  {" — "}
                  <Text color={theme.deletion}>
                    {Math.round(contextLeftPercent)}% context left
                  </Text>
                </>
              )}
            </>
          )}
        </Text>
      </Box>

      {filteredFiles.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="bold"
          borderRight={false}
          borderTop={false}
          borderBottom={false}
          borderLeftColor={theme.highlight}
          paddingLeft={2}
          marginTop={1}
          width={60}
        >
          <Box marginBottom={0} justifyContent="space-between">
            <Text bold color={theme.highlight}>
              AUTOCOMPLETE
            </Text>
            <Text color={theme.dim}>{filteredFiles.length} matches</Text>
          </Box>
          <Box flexDirection="column" marginTop={0}>
            {filteredFiles.map((f, i) => (
              <Box key={f} gap={2}>
                <Text
                  color={i === selectedFileIndex ? theme.highlight : theme.dim}
                  bold={i === selectedFileIndex}
                >
                  {i === selectedFileIndex ? "❯" : " "} {f}
                </Text>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {filteredSlashCommands.length > 0 &&
        input !== filteredSlashCommands[selectedSlashCommand]?.name && (
          <Box
            flexDirection="column"
            borderStyle="bold"
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderLeftColor={theme.highlight}
            paddingLeft={2}
            marginTop={1}
          >
            <Box marginBottom={1}>
              <Text bold color={theme.highlight}>
                COMMANDS
              </Text>
            </Box>
            {filteredSlashCommands.map((cmd, i) => (
              <Box key={cmd.name} gap={2}>
                <Text
                  color={
                    i === selectedSlashCommand ? theme.highlight : theme.dim
                  }
                  bold={i === selectedSlashCommand}
                >
                  {i === selectedSlashCommand ? "❯" : " "}{" "}
                  {cmd.name.toUpperCase().padEnd(12)}
                </Text>
                <Text color={theme.dim} italic={i !== selectedSlashCommand}>
                  {cmd.description}
                </Text>
              </Box>
            ))}
          </Box>
        )}
      {loading && !confirmationPrompt && (
        <Box paddingLeft={1}>
          <TerminalChatInputThinking
            onInterrupt={interruptAgent}
            active={active}
            partialReasoning={partialReasoning}
            activeBlockType={activeBlockType}
            activeToolName={activeToolName}
            activeToolArguments={activeToolArguments}
            isStreamingResponse={isStreamingResponse}
            theme={theme}
          />
        </Box>
      )}
    </Box>
  );
}
