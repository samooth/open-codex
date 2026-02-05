import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { AppConfig } from "../../utils/config.js";
import type { ColorName } from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import type { ReviewDecision } from "src/utils/agent/review.ts";

import TerminalChatInput from "./terminal-chat-input.js";
import { TerminalChatToolCallCommand } from "./terminal-chat-tool-call-item.js";
import {
  calculateContextPercentRemaining,
  calculateTokenBreakdown,
} from "./terminal-chat-utils.js";
import TerminalMessageHistory from "./terminal-message-history.js";
import TerminalStatusBar from "./terminal-status-bar.js";
import type { GroupedResponseItem } from "./use-message-grouping.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { useConfirmation } from "../../hooks/use-confirmation.js";
import { useTerminalSize } from "../../hooks/use-terminal-size.js";
import { AgentLoop } from "../../utils/agent/agent-loop.js";
import { log, isLoggingEnabled } from "../../utils/agent/log.js";
import { prefix } from "../../utils/agent/system-prompt.js";
import { createInputItem } from "../../utils/input-utils.js";
import { CLI_VERSION, setSessionId } from "../../utils/session.js";
import { shortCwd } from "../../utils/short-path.js";
import { saveRollout } from "../../utils/storage/save-rollout.js";
import ApprovalModeOverlay from "../approval-mode-overlay.js";
import ConfigOverlay from "../config-overlay.js";
import HelpOverlay from "../help-overlay.js";
import HistoryOverlay from "../history-overlay.js";
import ModelOverlay from "../model-overlay.js";
import PromptOverlay from "../prompt-overlay.js";
import PromptSelectOverlay from "../prompt-select-overlay.js";
import HistorySelectOverlay from "../history-select-overlay.js";
import MemoryOverlay from "../memory-overlay.js";
import RecipesOverlay from "../recipes-overlay.js";
import ThemeOverlay from "../theme-overlay.js";
import { getTheme } from "../../utils/theme.js";
import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { useInterval } from "use-interval";
import { inspect } from "util";

type Props = {
  config: AppConfig;
  prompt?: string;
  imagePaths?: Array<string>;
  rollout?: { items: Array<ChatCompletionMessageParam>; session: any };
  approvalPolicy: ApprovalPolicy;
  fullStdout: boolean;
};

const colorsByPolicy: Record<ApprovalPolicy, ColorName | undefined> = {
  "suggest": undefined,
  "auto-edit": "greenBright",
  "full-auto": "green",
};

export default function TerminalChat({
  config: initialConfig,
  prompt: _initialPrompt,
  imagePaths: _initialImagePaths,
  rollout: initialRollout,
  approvalPolicy: initialApprovalPolicy,
  fullStdout,
}: Props): React.ReactElement {
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [model, setModel] = useState<string>(config.model);
  const [prevItems, setPrevItems] = useState<Array<ChatCompletionMessageParam>>(
    initialRollout?.items || [],
  );
  const [items, setItems] = useState<Array<ChatCompletionMessageParam>>(
    initialRollout?.items || [],
  );
  const [loading, setLoading] = useState<boolean>(false);
  // Allow switching approval modes at runtime via an overlay.
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    initialApprovalPolicy,
  );
  
  // Use a ref for incoming partial data to avoid re-rendering TerminalChat on every chunk.
  // We only re-render when the throttled "rendered" state is updated via useInterval.
  const partialDataRef = React.useRef({
    content: "",
    reasoning: "",
    activeToolName: undefined as string | undefined,
    activeToolArguments: undefined as Record<string, any> | undefined,
    activeBlockType: undefined as "thought" | "think" | "plan" | undefined,
  });

  // Throttled state for rendering to avoid flickering
  const [renderedPartialData, setRenderedPartialData] = useState({
    content: "",
    reasoning: "",
    activeToolName: undefined as string | undefined,
    activeToolArguments: undefined as Record<string, any> | undefined,
    activeBlockType: undefined as "thought" | "think" | "plan" | undefined,
  });

  useInterval(() => {
    if (
      renderedPartialData.content !== partialDataRef.current.content ||
      renderedPartialData.reasoning !== partialDataRef.current.reasoning ||
      renderedPartialData.activeToolName !== partialDataRef.current.activeToolName ||
      renderedPartialData.activeToolArguments !== partialDataRef.current.activeToolArguments ||
      renderedPartialData.activeBlockType !== partialDataRef.current.activeBlockType
    ) {
      setRenderedPartialData({ ...partialDataRef.current });
    }
  }, loading ? 150 : null);

  const [promptQueue, setPromptQueue] = useState<
    Array<{ inputs: Array<ChatCompletionMessageParam>; prevItems: Array<ChatCompletionMessageParam> }>
  >([]);

  const { requestConfirmation, confirmationPrompt, submitConfirmation } =
    useConfirmation();
  const [overlayMode, setOverlayMode] = useState<
    "none" | "history" | "model" | "approval" | "help" | "config" | "prompt" | "memory" | "prompts" | "history-select" | "theme" | "recipes"
  >("none");

  const [initialPrompt, setInitialPrompt] = useState(_initialPrompt);
  const [initialImagePaths, setInitialImagePaths] =
    useState(_initialImagePaths);

  const awaitingContinueConfirmation = useMemo(() => {
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.role === "assistant" && !loading) {
      const content =
        typeof lastItem.content === "string"
          ? lastItem.content
          : Array.isArray(lastItem.content)
          ? lastItem.content
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("")
          : "";
      
      const normalized = content.trim().toLowerCase();
      
      // Simple Yes/No detection
      if (normalized.includes("continue?") || 
          normalized.includes("proceed?") || 
          normalized.includes("(yes/no)") ||
          normalized.includes("want me to continue") ||
          normalized.includes("should i go ahead") ||
          normalized.endsWith("?") && (
            normalized.includes("should i") || 
            normalized.includes("do you want") ||
            normalized.includes("allow me to") ||
            normalized.includes("is this correct") ||
            normalized.includes("is this okay") ||
            normalized.includes("can i proceed")
          )) {
        return { type: "yes-no" as const };
      }

      // Detection for multiple choices like [Option A] [Option B]
      const choiceMatches = content.match(/\[(.*?)\]/g);
      if (choiceMatches && choiceMatches.length >= 2) {
        const lastChoiceIndex = content.lastIndexOf(choiceMatches[choiceMatches.length - 1]!);
        const isNearEnd = lastChoiceIndex > (content.length - 100);
        if (isNearEnd || normalized.includes("choose") || normalized.includes("select") || normalized.includes("option")) {
          const choices = [
            ...new Set(choiceMatches.map((m) => m.slice(1, -1).trim())),
          ].filter(Boolean);
          
          if (choices.length >= 2) {
            return { type: "choices" as const, choices };
          }
        }
      }
    }
    return null;
  }, [items, loading]);

  const PWD = React.useMemo(() => shortCwd(), []);

  // Keep a single AgentLoop instance alive across renders;
  // recreate only when model/instructions/approvalPolicy/config change.
  const agentRef = React.useRef<AgentLoop>();
  const [, forceUpdate] = React.useReducer((c) => c + 1, 0); // trigger re‑render

  // ────────────────────────────────────────────────────────────────
  // DEBUG: log every render w/ key bits of state
  // ────────────────────────────────────────────────────────────────
  if (isLoggingEnabled()) {
    log(
      `render – agent? ${Boolean(agentRef.current)} loading=${loading} items=${
        items.length
      }`,
    );
  }

  useEffect(() => {
    if (isLoggingEnabled()) {
      log("creating NEW AgentLoop");
      log(
        `model=${model} instructions=${Boolean(
          config.instructions,
        )} approvalPolicy=${approvalPolicy}`,
      );
    }

    // Tear down any existing loop before creating a new one
    agentRef.current?.terminate();

    agentRef.current = new AgentLoop({
      model,
      config,
      instructions: config.instructions,
      approvalPolicy,
      onReset: () => {
        setPrevItems([]);
      },
      onPartialUpdate: (content: string, reasoning?: string, activeToolName?: string, activeToolArguments?: Record<string, any>) => {
        partialDataRef.current.content = content;
        if (reasoning) {
          if (activeToolName) {
            partialDataRef.current.reasoning = reasoning;
          } else {
            partialDataRef.current.reasoning += reasoning;
          }
        } else if (content) {
          // Extract <thought>, <think>, or <plan> content if present
          const thoughtMatch = content.match(/<(thought|think|plan)>([\s\S]*?)$|(<(thought|think|plan)>([\s\S]*?)<\/\4>)/g);
          if (thoughtMatch && thoughtMatch.length > 0) {
             const lastMatch = thoughtMatch[thoughtMatch.length - 1];
             if (lastMatch) {
               const type = lastMatch.startsWith("<thought") ? "thought" : lastMatch.startsWith("<think") ? "think" : "plan";
               partialDataRef.current.activeBlockType = type;
               const cleanThought = lastMatch
                 .replace(/<\/?(thought|think|plan)>/g, "")
                 .trim();
               if (cleanThought) {
                 partialDataRef.current.reasoning = cleanThought;
               }
             }
          }
        }
        partialDataRef.current.activeToolName = activeToolName;
        partialDataRef.current.activeToolArguments = activeToolArguments;
      },
      onItem: (item: ChatCompletionMessageParam) => {
        log(`onItem: ${JSON.stringify(item)}`);
        // Clear partials when a full item is received
        partialDataRef.current = {
          content: "",
          reasoning: "",
          activeToolName: undefined,
          activeToolArguments: undefined,
          activeBlockType: undefined,
        };
        setRenderedPartialData({ ...partialDataRef.current });

        setItems((prev) => {
          // If it's a streaming tool update, try to update the existing item
          if (item.role === "tool" && "tool_call_id" in item) {
            try {
              const content = JSON.parse(item.content as string);
              if (content.streaming) {
                const existingIndex = prev.findLastIndex(
                  (i) =>
                    i.role === "tool" &&
                    "tool_call_id" in i &&
                    i.tool_call_id === item.tool_call_id,
                );
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = item;
                  return updated;
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }

          const updated = [...prev, item];
          saveRollout(updated);
          return updated;
        });
        setPrevItems((prev) => {
          // Same logic for prevItems
          if (item.role === "tool" && "tool_call_id" in item) {
            try {
              const content = JSON.parse(item.content as string);
              if (content.streaming) {
                const existingIndex = prev.findLastIndex(
                  (i) =>
                    i.role === "tool" &&
                    "tool_call_id" in i &&
                    i.tool_call_id === item.tool_call_id,
                );
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = item;
                  return updated;
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }
          return [...prev, item];
        });
      },
      onLoading: (isLoading: boolean) => {
        if (isLoading) {
          partialDataRef.current = {
            content: "",
            reasoning: "",
            activeToolName: undefined,
            activeToolArguments: undefined,
            activeBlockType: undefined,
          };
          setRenderedPartialData({ ...partialDataRef.current });
        }
        setLoading(isLoading);
      },
      getCommandConfirmation: async (
        command: Array<string>,
        applyPatch: ApplyPatchCommand | undefined,
      ): Promise<CommandConfirmation> => {
        log(`getCommandConfirmation: ${command}`);
        const commandForDisplay = formatCommandForDisplay(command);
        const { decision: review, customDenyMessage } =
          await requestConfirmation(
            <TerminalChatToolCallCommand
              commandForDisplay={commandForDisplay}
              applyPatch={applyPatch}
              terminalRows={terminalRows}
            />,
          );
        return { review, customDenyMessage, applyPatch };
      },
    });

    // force a render so JSX below can "see" the freshly created agent
    forceUpdate();

    if (isLoggingEnabled()) {
      log(`AgentLoop created: ${inspect(agentRef.current, { depth: 1 })}`);
    }

    return () => {
      if (isLoggingEnabled()) {
        log("terminating AgentLoop");
      }
      agentRef.current?.terminate();
      agentRef.current = undefined;
      forceUpdate(); // re‑render after teardown too
    };
  }, [model, config, approvalPolicy, requestConfirmation]);

  // Let's also track whenever the ref becomes available
  const agent = agentRef.current;
  useEffect(() => {
    if (isLoggingEnabled()) {
      log(`agentRef.current is now ${Boolean(agent)}`);
    }
  }, [agent]);

  // Effect to process the prompt queue
  useEffect(() => {
    if (agent && !loading && promptQueue.length > 0) {
      const nextPrompt = promptQueue[0];
      if (nextPrompt) {
        setPromptQueue((prev) => prev.slice(1)); // Remove the processed prompt
        agent.run(nextPrompt.inputs, nextPrompt.prevItems);
      }
    }
  }, [agent, loading, promptQueue]);

  // ---------------------------------------------------------------------
  // Dynamic layout constraints – keep total rendered rows <= terminal rows
  // ---------------------------------------------------------------------

  const { rows: terminalRows } = useTerminalSize();

  useEffect(() => {
    const processInitialInputItems = async () => {
      if (
        (!initialPrompt || initialPrompt.trim() === "") &&
        (!initialImagePaths || initialImagePaths.length === 0)
      ) {
        return;
      }
      const inputItems = [
        await createInputItem(initialPrompt || "", initialImagePaths || []),
      ];
      // Clear them to prevent subsequent runs
      setInitialPrompt("");
      setInitialImagePaths([]);
      agent?.run(inputItems, prevItems);
    };
    processInitialInputItems();
  }, [agent, initialPrompt, initialImagePaths, prevItems]);

  // Group consecutive tool messages into batches
  const lastMessageBatch = useMemo(() => {
    const batches: Array<{ item?: ChatCompletionMessageParam; group?: GroupedResponseItem }> = [];
    let currentGroup: GroupedResponseItem | null = null;

    for (const item of items) {
      if (item.role === "tool") {
        if (!currentGroup) {
          currentGroup = {
            label: "Tool Batch",
            items: [item as any],
          };
        } else {
          currentGroup.items.push(item as any);
        }
      } else {
        if (currentGroup) {
          batches.push({ group: currentGroup });
          currentGroup = null;
        }
        batches.push({ item });
      }
    }
    if (currentGroup) {
      batches.push({ group: currentGroup });
    }
    return batches;
  }, [items]);

  const groupCounts: Record<string, number> = {};
  const userMsgCount = items.filter((i) => i.role === "user").length;

  const contextLeftPercent = useMemo(
    () => calculateContextPercentRemaining(items, model, config.contextSize),
    [items, model, config.contextSize],
  );

  const activeTheme = getTheme(config.theme);

  return (
    <Box flexDirection="column">
      {agent ? (
        <TerminalMessageHistory
          batch={lastMessageBatch}
          groupCounts={groupCounts}
          items={items}
          userMsgCount={userMsgCount}
          confirmationPrompt={confirmationPrompt}
          loading={loading}
          fullStdout={fullStdout}
          theme={activeTheme}
          headerProps={{
            terminalRows,
            version: CLI_VERSION,
            PWD,
            model,
            approvalPolicy,
            colorsByPolicy,
            agent,
            initialImagePaths,
          }}
          streamingMessage={loading && (renderedPartialData.content || renderedPartialData.reasoning) ? {
            role: "assistant",
            content: (() => {
              const content = renderedPartialData.content;
              // If reasoning is already embedded in content with tags, don't double wrap
              if (content.includes("<thought>") || content.includes("<think>")) {
                return content;
              }
              return content + (renderedPartialData.reasoning ? `<thought>${renderedPartialData.reasoning}</thought>` : "");
            })()
          } : undefined}
        />
      ) : (
        <Box>
          <Text color="gray">Initializing agent…</Text>
        </Box>
      )}

      {overlayMode === "none" && agent && (
        <TerminalChatInput
          loading={loading}
          setItems={setItems}
          isNew={Boolean(items.length === 0)}
          setPrevItems={setPrevItems}
          confirmationPrompt={confirmationPrompt}
          submitConfirmation={(
            decision: ReviewDecision,
            customDenyMessage?: string,
          ) =>
            submitConfirmation({
              decision,
              customDenyMessage,
            })
          }
          openOverlay={() => setOverlayMode("history")}
          openHistorySelectOverlay={() => setOverlayMode("history-select")}
          openModelOverlay={() => setOverlayMode("model")}
          openApprovalOverlay={() => setOverlayMode("approval")}
          openMemoryOverlay={() => setOverlayMode("memory")}
          openHelpOverlay={() => setOverlayMode("help")}
                      openConfigOverlay={() => setOverlayMode("config")}
                      openPromptOverlay={() => setOverlayMode("prompt")}
                      openPromptsOverlay={() => setOverlayMode("prompts")}
                      openRecipesOverlay={() => setOverlayMode("recipes")}
                      openThemeOverlay={() => setOverlayMode("theme")}
                      onPin={(path) => {            setConfig((prev) => ({
              ...prev,
              pinnedFiles: [...new Set([...(prev.pinnedFiles || []), path])],
            }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Pinned file: ${path}`,
              },
            ]);
          }}
          onUnpin={(path) => {
            setConfig((prev) => ({
              ...prev,
              pinnedFiles: (prev.pinnedFiles || []).filter((f) => f !== path),
            }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `Unpinned file: ${path}`,
              },
            ]);
          }}
          interruptAgent={() => {
            if (!agent) {
              return;
            }
            if (isLoggingEnabled()) {
              log(
                "TerminalChat: interruptAgent invoked – calling agent.cancel()",
              );
            }
            agent.cancel();
            setLoading(false);
          }}
          active={overlayMode === "none"}
          partialReasoning={renderedPartialData.reasoning}
          activeBlockType={renderedPartialData.activeBlockType}
          activeToolName={renderedPartialData.activeToolName}
          activeToolArguments={renderedPartialData.activeToolArguments}
          submitInput={(inputs) => {
            // If agent is not loading, run immediately. Otherwise, queue.
            if (!loading) {
              agent.run(inputs, prevItems);
            } else {
              setPromptQueue((prev) => [...prev, { inputs, prevItems }]);
            }
            return {};
          }}
          allowAlwaysPatch={config.allowAlwaysPatch}
          awaitingContinueConfirmation={awaitingContinueConfirmation}
        />
      )}

      {agent && (
        <TerminalStatusBar
          model={model}
          provider={config.provider || "openai"}
          contextLeftPercent={contextLeftPercent}
          tokenBreakdown={calculateTokenBreakdown(items)}
          sessionId={agent.sessionId}
          approvalPolicy={approvalPolicy}
          theme={activeTheme}
          queuedPromptsCount={promptQueue.length}
        />
      )}
        {overlayMode === "history" && (
          <HistoryOverlay items={items} onExit={() => setOverlayMode("none")} />
        )}
        {overlayMode === "history-select" && (
          <HistorySelectOverlay
            onSelect={(rollout) => {
              setItems(rollout.items);
              setPrevItems(rollout.items);
              if (rollout.session?.id) {
                setSessionId(rollout.session.id);
              }
              // Also update config instructions if they were saved in rollout
              if (rollout.session?.instructions) {
                setConfig(prev => ({ ...prev, instructions: rollout.session.instructions }));
              }
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}
        {overlayMode === "model" && (
          <ModelOverlay
            currentModel={model}
            config={config}
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
              setLoading(false);

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

              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "approval" && (
          <ApprovalModeOverlay
            currentMode={approvalPolicy}
            onSelect={(newMode) => {
              agent?.cancel();
              setLoading(false);
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

              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "help" && (
          <HelpOverlay onExit={() => setOverlayMode("none")} />
        )}

        {overlayMode === "config" && (
          <ConfigOverlay
            dryRun={!!config.dryRun}
            debug={!!process.env["DEBUG"]}
            enableWebSearch={!!config.enableWebSearch}
            enableDeepThinking={!!config.enableDeepThinking}
            onToggleDryRun={() => {
              setConfig((prev) => ({ ...prev, dryRun: !prev.dryRun }));
            }}
            onToggleDebug={() => {
              if (process.env["DEBUG"]) {
                delete process.env["DEBUG"];
              } else {
                process.env["DEBUG"] = "1";
              }
              // Force update to reflect debug status in UI if needed
              forceUpdate();
            }}
            onToggleWebSearch={() => {
              setConfig((prev) => ({ ...prev, enableWebSearch: !prev.enableWebSearch }));
            }}
            onToggleDeepThinking={() => {
              setConfig((prev) => ({ ...prev, enableDeepThinking: !prev.enableDeepThinking }));
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "prompt" && (
          <PromptOverlay
            currentInstructions={
              config.instructions?.includes("You are operating as and within OpenCodex")
                ? config.instructions
                : [prefix, config.instructions].filter(Boolean).join("\n")
            }
            onSave={(newInstructions) => {
              agent?.cancel();
              setLoading(false);
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
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "prompts" && (
          <PromptSelectOverlay
            onSelect={(newInstructions, name) => {
              agent?.cancel();
              setLoading(false);
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
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "theme" && (
          <ThemeOverlay
            currentTheme={typeof config.theme === 'string' ? config.theme : 'custom'}
            onSelect={(newTheme: any) => {
              setConfig((prev) => ({ ...prev, theme: newTheme }));
              setItems((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: [
                    {
                      type: "text",
                      text: `Switched theme to ${typeof newTheme === 'string' ? newTheme : (newTheme as any).name || 'custom'}`,
                    },
                  ],
                },
              ]);
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "recipes" && (
          <RecipesOverlay
            onSelect={(recipe) => {
              setItems((prev) => [
                ...prev,
                {
                  role: "user",
                  content: [{ type: "text", text: recipe.prompt }],
                },
              ]);
              agent?.run(
                [
                  {
                    role: "user",
                    content: [{ type: "text", text: recipe.prompt }],
                  },
                ],
                prevItems,
              );
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "memory" && (
          <MemoryOverlay onExit={() => setOverlayMode("none")} />
        )}
    </Box>
  );
}
