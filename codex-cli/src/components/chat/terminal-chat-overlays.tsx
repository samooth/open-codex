import type { ApprovalPolicy } from "../../approvals.js";
import type { ExtendedChatCompletionMessageParam } from "../../app";
import { useAppContext } from "../../contexts/app-context.js";
import { clearTerminal } from "../../utils/terminal.js";
import { setSessionId } from "../../utils/session.js";
import { recipes } from "../../utils/recipes.js";
import { log, isLoggingEnabled } from "../../utils/agent/log.js";
import { saveConfig } from "../../utils/config.js";
import { prefix } from "../../utils/agent/system-prompt.js";
import ApprovalModeOverlay from "../approval-mode-overlay.js";
import CommandHistoryOverlay from "../command-history-overlay.js";
import CommandPaletteOverlay from "../command-palette-overlay.js";
import ConfigOverlay from "../config-overlay.js";
import EditorOverlay from "../editor-overlay.js";
import HelpOverlay from "../help-overlay.js";
import HistoryOverlay from "../history-overlay.js";
import HistorySelectOverlay from "../history-select-overlay.js";
import MemoryOverlay from "../memory-overlay.js";
import ModelOverlay from "../model-overlay.js";
import PromptOverlay from "../prompt-overlay.js";
import PromptSelectOverlay from "../prompt-select-overlay.js";
import RecipesOverlay from "../recipes-overlay.js";
import SearchUrlOverlay from "../search-url-overlay.js";
import ThemeOverlay from "../theme-overlay.js";
import React from "react";

type Props = {
  model: string;
  setModel: (model: string) => void;
  items: Array<ExtendedChatCompletionMessageParam>;
  setItems: React.Dispatch<
    React.SetStateAction<Array<ExtendedChatCompletionMessageParam>>
  >;
  prevItems: Array<ExtendedChatCompletionMessageParam>;
  setPrevItems: React.Dispatch<
    React.SetStateAction<Array<ExtendedChatCompletionMessageParam>>
  >;
  approvalPolicy: ApprovalPolicy;
  setApprovalPolicy: (policy: ApprovalPolicy) => void;
  handleUndo: () => void;
  agent: any;
  activeTheme: any;
  handleRefresh: () => void;
  setInitialPrompt: (prompt: string) => void;
};

export default function TerminalChatOverlays({
  model,
  setModel,
  items,
  setItems,
  prevItems,
  setPrevItems,
  approvalPolicy,
  setApprovalPolicy,
  handleUndo,
  agent,
  activeTheme,
  handleRefresh,
  setInitialPrompt,
}: Props) {
  const { config, setConfig, overlayMode, openOverlay, closeOverlay } =
    useAppContext();

  if (overlayMode === "none") {
    return null;
  }

  return (
    <>
      {overlayMode === "history" && (
        <HistoryOverlay
          items={items}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}
      {overlayMode === "history-select" && (
        <HistorySelectOverlay
          onSelect={(rollout) => {
            // Sanitize items: Remove any trailing assistant message that has tool_calls
            // but no subsequent tool response. This prevents OpenAI 400 errors.
            let sanitizedItems = [...rollout.items];
            while (sanitizedItems.length > 0) {
              const lastItem = sanitizedItems[sanitizedItems.length - 1];
              if (
                lastItem &&
                lastItem.role === "assistant" &&
                lastItem.tool_calls &&
                lastItem.tool_calls.length > 0
              ) {
                // If it's an assistant message with tool calls, check if all calls have responses
                // In a restored rollout, we don't easily know if the next message *exists*
                // but isn't in this array, but if it's the absolute last message,
                // it definitely has no response.
                sanitizedItems.pop();
                if (isLoggingEnabled()) {
                  log(
                    "Sanitized rollout: Removed trailing assistant message with tool_calls",
                  );
                }
              } else {
                break;
              }
            }

            setItems(sanitizedItems);
            setPrevItems(sanitizedItems);
            if (rollout.session?.id) {
              setSessionId(rollout.session.id);
            }
            // Also update config instructions if they were saved in rollout
            if (rollout.session?.instructions) {
              setConfig((prev) => ({
                ...prev,
                instructions: rollout.session.instructions,
              }));
            }
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}
      {overlayMode === "model" && (
        <ModelOverlay
          currentModel={model}
          hasLastResponse={Boolean(prevItems.length > 0)}
          onSelect={(newModel) => {
            if (isLoggingEnabled()) {
              log(
                "TerminalChat: interruptAgent invoked – calling agent.cancel()",
              );
              if (!agent) {
                log("TerminalChat: agent is not ready yet");
              }
            }
            agent?.cancel();

            setModel(newModel);
            setPrevItems((prev) => {
              return prev && newModel !== model ? [] : prev;
            });

            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Switched model to ${newModel}`,
                  },
                ],
              },
            ]);

            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "approval" && (
        <ApprovalModeOverlay
          currentMode={approvalPolicy}
          onSelect={(newMode) => {
            agent?.cancel();
            if (newMode === approvalPolicy) {
              return;
            }
            setApprovalPolicy(newMode as ApprovalPolicy);
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Switched approval mode to ${newMode}`,
                  },
                ],
              },
            ]);

            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "help" && (
        <HelpOverlay onExit={closeOverlay} theme={activeTheme} />
      )}

      {overlayMode === "config" && (
        <ConfigOverlay onExit={closeOverlay} theme={activeTheme} />
      )}

      {overlayMode === "editor" && (
        <EditorOverlay
          currentCommand={config.editorCommand || ""}
          onRefresh={handleRefresh}
          onSave={(newCommand) => {
            const newConfig = {
              ...config,
              editorCommand: newCommand || undefined,
            };
            setConfig(newConfig);
            saveConfig(newConfig);
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Updated editor command to: ${
                  newCommand || "default ($EDITOR)"
                }`,
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "search-url-searxng" && (
        <SearchUrlOverlay
          title="SET SEARXNG INSTANCE URL"
          currentUrl={config.searxngUrl || ""}
          onRefresh={handleRefresh}
          onSave={(newUrl) => {
            setConfig((prev) => ({ ...prev, searxngUrl: newUrl || undefined }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Updated SearXNG URL to: ${
                  newUrl || "default (DuckDuckGo fallback)"
                }`,
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "serp-api-key" && (
        <SearchUrlOverlay
          title="SET SERP API KEY"
          subtitle="CONFIGURE SEARCH API"
          label="API KEY: "
          placeholder="Enter your API key..."
          description="Enter the API key for serper.dev or compatible search provider."
          currentUrl={config.serpApiKey || ""}
          onRefresh={handleRefresh}
          onSave={(newKey) => {
            const newConfig = { ...config, serpApiKey: newKey || undefined };
            setConfig(newConfig);
            saveConfig(newConfig);
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Updated SERP API key.`,
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "search-url-generic" && (
        <SearchUrlOverlay
          title="SET GENERIC SEARCH URL"
          currentUrl={config.webSearchUrl || ""}
          onRefresh={handleRefresh}
          onSave={(newUrl) => {
            setConfig((prev) => ({
              ...prev,
              webSearchUrl: newUrl || undefined,
            }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Updated generic search URL to: ${
                  newUrl || "default (DuckDuckGo fallback)"
                }`,
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "prompt" && (
        <PromptOverlay
          currentInstructions={
            config.instructions?.includes(
              "You are operating as and within OpenCodex",
            )
              ? config.instructions
              : [prefix, config.instructions].filter(Boolean).join("\n")
          }
          onRefresh={handleRefresh}
          onSave={(newInstructions) => {
            agent?.cancel();
            setConfig((prev) => ({ ...prev, instructions: newInstructions }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Updated system instructions.`,
                  },
                ],
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "prompts" && (
        <PromptSelectOverlay
          onSelect={(newInstructions, name) => {
            agent?.cancel();
            setConfig((prev) => ({ ...prev, instructions: newInstructions }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Switched system instructions to prompt: ${name}`,
                  },
                ],
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "theme" && (
        <ThemeOverlay
          currentTheme={
            typeof config.theme === "string" ? config.theme : "custom"
          }
          onSelect={(newTheme: any) => {
            clearTerminal();
            handleRefresh();
            setConfig((prev) => ({ ...prev, theme: newTheme }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: [
                  {
                    type: "text",
                    text: `Switched theme to ${
                      typeof newTheme === "string"
                        ? newTheme
                        : (newTheme as any).name || "custom"
                    }`,
                  },
                ],
              },
            ]);
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "recipes" && (
        <RecipesOverlay
          onSelect={(recipe) => {
            agent?.run(
              [
                {
                  role: "user",
                  content: [{ type: "text", text: recipe.prompt }],
                },
              ],
              prevItems,
            );
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "palette" && (
        <CommandPaletteOverlay
          onSelect={(value, type) => {
            if (type === "command") {
              // Trigger slash command logic by submitting it
              // We'll let TerminalChatInput handle it or implement it here
              // For simplicity, we just set the overlay mode based on the command
              if (value === "/model") {
                openOverlay("model");
              } else if (value === "/clear") {
                // Reuse clear logic
                setSessionId("");
                setPrevItems([]);
                clearTerminal();
                setItems((prev) => [
                  ...prev,
                  { role: "assistant", content: "Context cleared" },
                ]);
                closeOverlay();
              } else if (value === "/history") {
                openOverlay("history");
              } else if (value === "/history restore") {
                openOverlay("history-select");
              } else if (value === "/memory") {
                openOverlay("memory");
              } else if (value === "/approval") {
                openOverlay("approval");
              } else if (value === "/config") {
                openOverlay("config");
              } else if (value === "/prompt") {
                openOverlay("prompt");
              } else if (value === "/prompts") {
                openOverlay("prompts");
              } else if (value === "/theme") {
                openOverlay("theme");
              } else if (value === "/undo") {
                handleUndo();
                closeOverlay();
              } else if (value === "/index") {
                agent?.run(
                  [
                    {
                      role: "user",
                      content: "Please index the codebase for semantic search.",
                    },
                  ],
                  prevItems,
                );
                closeOverlay();
              }
            } else if (type === "recipe") {
              const recipe = recipes.find((r) => r.name === value);
              if (recipe) {
                agent?.run(
                  [{ role: "user", content: recipe.prompt }],
                  prevItems,
                );
              }
              closeOverlay();
            }
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}

      {overlayMode === "memory" && (
        <MemoryOverlay onExit={closeOverlay} theme={activeTheme} />
      )}
      {overlayMode === "commands" && (
        <CommandHistoryOverlay
          items={items}
          onSelect={(cmd) => {
            // We'll use a hack to set the input by passing it to TerminalChatInput via a ref or a shared state.
            // For now, let's just use the promptQueue or similar mechanism, or just set overlay to none and hope the user knows.
            // Actually, we should probably add a way to set the input value in TerminalChat.
            setInitialPrompt(cmd); // This will populate the input on next render if we handle it in TerminalChatInput
            closeOverlay();
          }}
          onExit={closeOverlay}
          theme={activeTheme}
        />
      )}
    </>
  );
}
