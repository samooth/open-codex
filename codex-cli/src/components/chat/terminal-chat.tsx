import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { AppConfig } from "../../utils/config.js";
import type { ColorName } from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import type { ReviewDecision } from "../../utils/agent/review.js";
import type { Task } from "../../utils/agent/types.js";

import TerminalChatInput from "./terminal-chat-input.js";
import { TerminalChatToolCallCommand } from "./terminal-chat-tool-call-item.js";
import {
  calculateContextPercentRemaining,
  calculateTokenBreakdown,
} from "./terminal-chat-utils.js";
import TerminalMessageHistory from "./terminal-message-history.js";
import TaskChecklist from "./task-checklist.js";
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
import { clearTerminal } from "../../utils/terminal.js";
import { saveRollout, undoLastChange } from "../../utils/storage/save-rollout.js";
import { listAllFiles } from "../../utils/list-all-files.js";
import { detectInteraction } from "../../utils/interactive-detection.js";
import ApprovalModeOverlay from "../approval-mode-overlay.js";
import fs from "fs";
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
  const { rows } = useTerminalSize();
  
  // Group related state to ensure atomic updates and avoid flickering.
  // We separate committedItems (rendered by Static) from turnItems (rendered normally)
  // to prevent re-printing the whole history when a new token arrives.
  const [chatState, setChatState] = useState({
    committedItems: initialRollout?.items || [] as Array<ChatCompletionMessageParam>,
    turnItems: [] as Array<ChatCompletionMessageParam>,
    prevItems: initialRollout?.items || [] as Array<ChatCompletionMessageParam>,
    loading: false,
    historyKey: 0,
    renderedPartialData: {
      content: "",
      reasoning: "",
      activeToolName: undefined as string | undefined,
      activeToolArguments: undefined as Record<string, any> | undefined,
      activeBlockType: undefined as "thought" | "think" | "plan" | undefined,
    }
  });

  const { committedItems, turnItems, prevItems, loading, renderedPartialData, historyKey } = chatState;
  const items = [...committedItems, ...turnItems];

  const [tasks, setTasks] = useState<Task[]>([]);
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [pendingApplyPatch, setPendingApplyPatch] = useState<ApplyPatchCommand | undefined>();
  // Allow switching approval modes at runtime via an overlay.
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    initialApprovalPolicy,
  );

  useEffect(() => {
    // Fetch all files once on mount to avoid blocking UI during chat
    setTimeout(() => {
      setAllFiles(listAllFiles());
    }, 100);
  }, []);
  
  // Use a ref for incoming partial data to avoid re-rendering TerminalChat on every chunk.
  // We only re-render when the throttled "rendered" state is updated via useInterval.
  const partialDataRef = React.useRef({
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
      setChatState(prev => ({
        ...prev,
        renderedPartialData: { ...partialDataRef.current }
      }));
    }
  }, loading ? 600 : null);

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

  const handleUndo = async () => {
    if (!agent) return;
    setChatState(prev => ({ ...prev, loading: true }));
    const result = await undoLastChange(
      agent.sessionId,
      (p, c) => fs.writeFileSync(p, c, "utf-8"),
      (p) => { if (fs.existsSync(p)) fs.unlinkSync(p); }
    );
    
    if (result.success) {
      const assistantMsg = {
        role: "assistant" as const,
        content: `🔄 ${result.message}`
      };
      setChatState(prev => ({
        ...prev,
        committedItems: [...result.items, assistantMsg],
        turnItems: [],
        prevItems: result.items,
        loading: false,
        historyKey: prev.historyKey + 1
      }));
    } else {
      const errorMsg = {
        role: "assistant" as const,
        content: `⚠️ ${result.message}`
      };
      setChatState(prev => ({
        ...prev,
        committedItems: [...prev.committedItems, errorMsg],
        turnItems: [],
        loading: false,
        historyKey: prev.historyKey + 1
      }));
    }
  };

  const awaitingContinueConfirmation = useMemo(() => {
    const lastItem = items[items.length - 1];
    // Only show if the agent is idle, no confirmation is pending, and the prompt queue is completely empty.
    // This prevents the box from popping up during automatic "Please continue" sequences.
    if (lastItem && lastItem.role === "assistant" && !loading && !confirmationPrompt && promptQueue.length === 0) {
      const content =
        typeof lastItem.content === "string"
          ? lastItem.content
          : Array.isArray(lastItem.content)
          ? lastItem.content
              .map((c) => (c.type === "text" ? (c as any).text : ""))
              .join("")
          : "";
      
      return detectInteraction(content);
    }
    return null;
  }, [items, loading, confirmationPrompt, promptQueue.length]);

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
                          setChatState(prev => ({ ...prev, committedItems: [], turnItems: [], prevItems: [], historyKey: prev.historyKey + 1 }));
                          setTasks([]);
                        },            onTasksUpdate: (newTasks) => {
              setTasks(newTasks);
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
                                        // Extract <thought>, <think>, or <plan> content if present (handles unclosed tags)
                                        // We prioritize the most recently opened tag that is still open.
                                        const planMatch = content.match(/<plan>([\s\S]*?)$/i);
                                        const thoughtMatch = content.match(/<(thought|think)>([\s\S]*?)$/i);
                                        
                                        if (planMatch) {
                                          partialDataRef.current.activeBlockType = "plan";
                                          partialDataRef.current.reasoning = (planMatch[1] || "").trim();
                                        } else if (thoughtMatch) {
                                          partialDataRef.current.activeBlockType = thoughtMatch[1]?.toLowerCase() === "think" ? "think" : "thought";
                                          partialDataRef.current.reasoning = (thoughtMatch[2] || "").trim();
                                        } else {
                                          // Fallback to searching for the last closed/unclosed block if no trailing open tag found
                                          const anyMatch = content.match(/<(thought|think|plan)>([\s\S]*?)(?:<\/(?:thought|think|plan)>|$)/gi);
                                          if (anyMatch && anyMatch.length > 0) {
                                            const lastMatch = anyMatch[anyMatch.length - 1];
                                            if (lastMatch) {
                                              const typeMatch = lastMatch.match(/<(thought|think|plan)>/i);
                                              const type = typeMatch ? (typeMatch[1]?.toLowerCase() as any) : "thought";
                                              partialDataRef.current.activeBlockType = type;
                                              partialDataRef.current.reasoning = lastMatch
                                                .replace(/<\/?(thought|think|plan)>/gi, "")
                                                .trim();
                                            }
                                          }
                                        }
                                      }              partialDataRef.current.activeToolName = activeToolName;
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
      
              setChatState((prev) => {
                let nextTurnItems = [...prev.turnItems];
                let nextPrevItems = [...prev.prevItems];
      
                // If it's a streaming tool update, try to update the existing item in the current turn
                if (item.role === "tool" && "tool_call_id" in item) {
                  try {
                    const content = JSON.parse(item.content as string);
                    if (content.streaming) {
                      const existingIndex = nextTurnItems.findLastIndex(
                        (i) =>
                          i.role === "tool" &&
                          "tool_call_id" in i &&
                          i.tool_call_id === item.tool_call_id,
                      );
                      if (existingIndex !== -1) {
                        nextTurnItems[existingIndex] = item;
                      } else {
                        nextTurnItems.push(item);
                      }
      
                      const existingPrevIndex = nextPrevItems.findLastIndex(
                        (i) =>
                          i.role === "tool" &&
                          "tool_call_id" in i &&
                          i.tool_call_id === item.tool_call_id,
                      );
                      if (existingPrevIndex !== -1) {
                        nextPrevItems[existingPrevIndex] = item;
                      } else {
                        nextPrevItems.push(item);
                      }
                    } else {
                      nextTurnItems.push(item);
                      nextPrevItems.push(item);
                    }
                  } catch {
                    nextTurnItems.push(item);
                    nextPrevItems.push(item);
                  }
                } else {
                  nextTurnItems.push(item);
                  nextPrevItems.push(item);
                }
      
                saveRollout([...prev.committedItems, ...nextTurnItems]);
                
                return {
                  ...prev,
                  turnItems: nextTurnItems,
                  prevItems: nextPrevItems,
                  renderedPartialData: { ...partialDataRef.current }
                };
              });
            },
            onLoading: (isLoading: boolean) => {
              setChatState(prev => {
                if (isLoading) {
                  // Starting a new turn - items from previous turn are now committed
                  return {
                    ...prev,
                    committedItems: [...prev.committedItems, ...prev.turnItems],
                    turnItems: [],
                    loading: true,
                    renderedPartialData: {
                      content: "",
                      reasoning: "",
                      activeToolName: undefined,
                      activeToolArguments: undefined,
                      activeBlockType: undefined,
                    }
                  };
                } else {
                  // Turn finished
                  return {
                    ...prev,
                    loading: false,
                    renderedPartialData: {
                      content: "",
                      reasoning: "",
                      activeToolName: undefined,
                      activeToolArguments: undefined,
                      activeBlockType: undefined,
                    }
                  };
                }
              });
            },
      getCommandConfirmation: async (
        command: Array<string>,
        applyPatch: ApplyPatchCommand | undefined,
      ): Promise<CommandConfirmation> => {
        log(`getCommandConfirmation: ${command}`);
        const commandForDisplay = formatCommandForDisplay(command);
        setPendingApplyPatch(applyPatch);
        const { decision: review, customDenyMessage, updatedApplyPatch } =
          await requestConfirmation(
            <TerminalChatToolCallCommand
              commandForDisplay={commandForDisplay}
              applyPatch={applyPatch}
              theme={activeTheme}
              height={rows}
            />,
          );
        setPendingApplyPatch(undefined);
        return { review, customDenyMessage, applyPatch: updatedApplyPatch || applyPatch };
      },
      getUserChoice: async (prompt: string, choices?: string[]): Promise<string> => {
        log(`getUserChoice: ${prompt} (${choices?.join(", ")})`);
        const { decision, customDenyMessage } = await requestConfirmation(
          <Box flexDirection="column" gap={1}>
            <Text bold color={activeTheme.highlight}>{prompt}</Text>
            {choices && (
              <Box flexDirection="column" paddingLeft={2}>
                {choices.map((c, i) => (
                  <Text key={i} color={activeTheme.dim}>• {c}</Text>
                ))}
              </Box>
            )}
          </Box>,
        );
        return customDenyMessage || decision;
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

  const initialPromptProcessed = React.useRef(false);
  useEffect(() => {
    const processInitialInputItems = async () => {
      if (initialPromptProcessed.current) return;
      if (
        (!initialPrompt || initialPrompt.trim() === "") &&
        (!initialImagePaths || initialImagePaths.length === 0)
      ) {
        return;
      }
      initialPromptProcessed.current = true;
      const inputItems = [
        await createInputItem(initialPrompt || "", initialImagePaths || []),
      ];
      // Clear them to prevent subsequent runs
      setInitialPrompt("");
      setInitialImagePaths([]);
      agent?.run(inputItems, prevItems);
    };
    processInitialInputItems();
  }, [agent, initialPrompt, initialImagePaths]); // Removed prevItems from dependencies

  // Group consecutive tool messages into batches
  const getBatches = (itemsArr: ChatCompletionMessageParam[]) => {
    const batches: Array<{ item?: ChatCompletionMessageParam; group?: GroupedResponseItem }> = [];
    let currentGroup: GroupedResponseItem | null = null;

    for (const item of itemsArr) {
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
  };

  const committedBatches = useMemo(() => getBatches(committedItems), [committedItems]);
  const turnBatches = useMemo(() => getBatches(turnItems), [turnItems]);

  const toolCallMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of items) {
      if (item.role === "assistant" && item.tool_calls) {
        for (const tc of item.tool_calls) {
          map.set(tc.id, tc);
        }
      }
    }
    return map;
  }, [items]);

  const userMsgCount = items.filter((i) => i.role === "user").length;

  const contextLeftPercent = useMemo(
    () => calculateContextPercentRemaining(items, model, config.contextSize),
    [items, model, config.contextSize],
  );

  const activeTheme = getTheme(config.theme);

  // Dynamic layout constraints
  const statusBarHeight = 1;
  const roadmapHeight = (tasks.length > 0 && !confirmationPrompt) ? tasks.length + 2 : 0;
  const inputHeight = loading ? 4 : 10; // Thinking indicator vs full editor
  const availableHistoryHeight = Math.max(5, rows - statusBarHeight - roadmapHeight - inputHeight - 6);

  const memoizedStreamingMessage = useMemo(() => {
    if (!loading || (!renderedPartialData.content && !renderedPartialData.reasoning)) {
      return undefined;
    }
    
    const content = renderedPartialData.content;
    let finalContent = content;
    // If reasoning is already embedded in content with tags, don't double wrap
    if (!content.includes("<thought>") && !content.includes("<think>")) {
      finalContent = content + (renderedPartialData.reasoning ? `<thought>${renderedPartialData.reasoning}</thought>` : "");
    }

    return {
      role: "assistant" as const,
      content: finalContent,
    };
  }, [loading, renderedPartialData.content, renderedPartialData.reasoning, historyKey]);

  return (
    <Box flexDirection="column">
      {agent ? (
        <TerminalMessageHistory
          committedBatches={committedBatches}
          turnBatches={turnBatches}
          toolCallMap={toolCallMap}
          userMsgCount={userMsgCount}
          model={model}
          confirmationPrompt={confirmationPrompt}
          submitConfirmation={(
            decision: ReviewDecision,
            customDenyMessage?: string,
            updatedApplyPatch?: ApplyPatchCommand,
          ) =>
            submitConfirmation({
              decision,
              customDenyMessage,
              updatedApplyPatch,
            })
          }
          allowAlwaysPatch={config.allowAlwaysPatch}
          applyPatch={pendingApplyPatch}
          loading={loading}
          fullStdout={fullStdout}
          theme={activeTheme}
          headerProps={{
            version: CLI_VERSION,
            PWD,
            model,
            approvalPolicy,
            colorsByPolicy,
            agent,
            initialImagePaths: _initialImagePaths,
            theme: activeTheme,
          }}
          streamingMessage={memoizedStreamingMessage}
          height={availableHistoryHeight}
          historyKey={historyKey}
        />
      ) : (
        <Box>
          <Text color="gray">Initializing agent…</Text>
        </Box>
      )}

      {tasks.length > 0 && !confirmationPrompt && (
        <Box marginTop={1}>
          <TaskChecklist tasks={tasks} theme={activeTheme} maxHeight={Math.max(3, Math.floor(rows / 4))} />
        </Box>
      )}

      {overlayMode === "none" && agent && (
        <TerminalChatInput
          loading={loading}
          setChatState={setChatState}
          isNew={Boolean(items.length === 0)}
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
                      onUndo={handleUndo}
                      onPin={(path) => {            setConfig((prev) => ({
              ...prev,
              pinnedFiles: [...new Set([...(prev.pinnedFiles || []), path])],
            }));
            setChatState((prev) => ({
              ...prev,
              turnItems: [
                ...prev.turnItems,
                {
                  role: "assistant",
                  content: `Pinned file: ${path}`,
                },
              ]
            }));
          }}
          onUnpin={(path) => {
            setConfig((prev) => ({
              ...prev,
              pinnedFiles: (prev.pinnedFiles || []).filter((f) => f !== path),
            }));
            setChatState((prev) => ({
              ...prev,
              turnItems: [
                ...prev.turnItems,
                {
                  role: "assistant",
                  content: `Unpinned file: ${path}`,
                },
              ]
            }));
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
            setChatState(prev => ({ ...prev, loading: false }));
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
          theme={activeTheme}
          allFiles={allFiles}
          isStreamingResponse={!!memoizedStreamingMessage}
          maxHeight={availableHistoryHeight}
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
          <HistoryOverlay items={items} onExit={() => setOverlayMode("none")} theme={activeTheme} />
        )}
        {overlayMode === "history-select" && (
          <HistorySelectOverlay
            onSelect={(rollout) => {
              setChatState(prev => ({
                ...prev,
                committedItems: rollout.items,
                turnItems: [],
                prevItems: rollout.items,
                historyKey: prev.historyKey + 1
              }));
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
            theme={activeTheme}
          />
        )}
        {overlayMode === "model" && (
          <ModelOverlay
            currentModel={model}
            config={config}
            theme={activeTheme}
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
              
              setChatState(prev => ({
                ...prev,
                loading: false,
                prevItems: newModel !== model ? [] : prev.prevItems,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: `Switched model to ${newModel}`,
                      },
                    ],
                  },
                ]
              }));

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
              
              if (newMode === approvalPolicy) {
                setChatState(prev => ({ ...prev, loading: false }));
                setOverlayMode("none");
                return;
              }
              setApprovalPolicy(newMode as ApprovalPolicy);
              setChatState(prev => ({
                ...prev,
                loading: false,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: `Switched approval mode to ${newMode}`,
                      },
                    ],
                  },
                ]
              }));

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
              setConfig((prev) => ({ ...prev, instructions: newInstructions }));
              setChatState(prev => ({
                ...prev,
                loading: false,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: `Updated system instructions.`,
                      },
                    ],
                  },
                ]
              }));
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "prompts" && (
          <PromptSelectOverlay
            onSelect={(newInstructions, name) => {
              agent?.cancel();
              setConfig((prev) => ({ ...prev, instructions: newInstructions }));
              setChatState(prev => ({
                ...prev,
                loading: false,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: `Switched system instructions to prompt: ${name}`,
                      },
                    ],
                  },
                ]
              }));
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
            theme={activeTheme}
          />
        )}

        {overlayMode === "theme" && (
          <ThemeOverlay
            currentTheme={typeof config.theme === 'string' ? config.theme : 'custom'}
            onSelect={(newTheme: any) => {
              clearTerminal();
              setConfig((prev) => ({ ...prev, theme: newTheme }));
              setChatState(prev => ({
                ...prev,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "assistant",
                    content: [
                      {
                        type: "text",
                        text: `Switched theme to ${typeof newTheme === 'string' ? newTheme : (newTheme as any).name || 'custom'}`,
                      },
                    ],
                  },
                ]
              }));
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "recipes" && (
          <RecipesOverlay
            onSelect={(recipe) => {
              setChatState(prev => ({
                ...prev,
                turnItems: [
                  ...prev.turnItems,
                  {
                    role: "user" as const,
                    content: [{ type: "text" as const, text: recipe.prompt }],
                  },
                ]
              }));
              setOverlayMode("none");
            }}
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "memory" && (
          <MemoryOverlay onExit={() => setOverlayMode("none")} theme={activeTheme} />
        )}
    </Box>
  );
}
