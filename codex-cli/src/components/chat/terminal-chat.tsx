import type { GroupedResponseItem } from "./use-message-grouping.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { ReviewDecision } from "../../utils/agent/review.js";
import type { Task } from "../../utils/agent/types.js";
import type { ColorName } from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions/completions.mjs";
// @ts-expect-error - MessageStatus is used in types but not in code currently
import type { ExtendedChatCompletionMessageParam, MessageStatus } from "../../app";



import TaskChecklist from "./task-checklist.js";
import TerminalChatInput from "./terminal-chat-input.js";
import { TerminalChatToolCallCommand } from "./terminal-chat-tool-call-item.js";
import {
  calculateContextPercentRemaining,
  calculateTokenBreakdown,
} from "./terminal-chat-utils.js";
import TerminalMessageHistory from "./terminal-message-history.js";
import TerminalStatusBar from "./terminal-status-bar.js";
import { useAppContext } from "../../contexts/app-context.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { useConfirmation } from "../../hooks/use-confirmation.js";
import { AgentLoop } from "../../utils/agent/agent-loop.js";
import { PluginManager } from "../../utils/agent/plugin-manager.js";
import { log, isLoggingEnabled } from "../../utils/agent/log.js";
import { prefix } from "../../utils/agent/system-prompt.js";
import { createInputItem } from "../../utils/input-utils.js";
import { detectInteraction } from "../../utils/interactive-detection.js";
import { listAllFiles } from "../../utils/list-all-files.js";
import { recipes } from "../../utils/recipes.js";
import { CLI_VERSION, setSessionId } from "../../utils/session.js";
import { parseToolCallOutput } from "../../utils/parsers.js";
import { shortCwd } from "../../utils/short-path.js";
import {
  saveRollout,
  undoLastChange,
} from "../../utils/storage/save-rollout.js";
import { clearTerminal, setTerminalTitle, beep } from "../../utils/terminal.js";
import { getTheme } from "../../utils/theme.js";
import { saveConfig } from "../../utils/config.js";
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
import clipboard from "clipboardy";
import isEqual from "fast-deep-equal";
import fs from "fs";
import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { useInterval } from "use-interval";
import { inspect } from "util";

type Props = {
  prompt?: string;
  imagePaths?: Array<string>;
  rollout?: { items: Array<ExtendedChatCompletionMessageParam>; session: any };
  approvalPolicy: ApprovalPolicy;
  fullStdout: boolean;
  onShutdown?: (
    model: string,
    items: Array<ExtendedChatCompletionMessageParam>,
  ) => void;
};

const colorsByPolicy: Record<ApprovalPolicy, ColorName | undefined> = {
  "suggest": undefined,
  "auto-edit": "greenBright",
  "full-auto": "green",
};

export default function TerminalChat({
  prompt: _initialPrompt,
  imagePaths: _initialImagePaths,
  rollout: initialRollout,
  approvalPolicy: initialApprovalPolicy,
  fullStdout,
  onShutdown,
}: Props): React.ReactElement {
  const { config, setConfig, overlayMode, openOverlay, closeOverlay } =
    useAppContext();
  const [model, setModel] = useState<string>(config.model);
  const [prevItems, setPrevItems] = useState<Array<ExtendedChatCompletionMessageParam>>(
    initialRollout?.items || [],
  );
  const [items, setItems] = useState<Array<ExtendedChatCompletionMessageParam>>(
    initialRollout?.items || [],
  );
  const [tasks, setTasks] = useState<Array<Task>>([]);
  const [indexingStatus, setIndexingStatus] = useState<{
    indexing: boolean;
    current?: number;
    total?: number;
    file?: string;
  }>({ indexing: false });
  const [shellFocused, setShellFocused] = useState(false);
  const [allFiles, setAllFiles] = useState<Array<string>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  // Allow switching approval modes at runtime via an overlay.
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    initialApprovalPolicy,
  );

  const [lastFileAccess, setLastFileAccess] = useState<string | undefined>(
    undefined,
  );
  const fileAccessCounts = React.useRef<Record<string, number>>({});
  const [lastCodeBlock, setLastCodeBlock] = useState<string | undefined>(
    undefined,
  );
  const [pendingPinAction, setPendingPinAction] = useState<
    "pin" | "unpin" | null
  >(null);

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

  // Throttled state for rendering to avoid flickering
  const [renderedPartialData, setRenderedPartialData] = useState({
    content: "",
    reasoning: "",
    activeToolName: undefined as string | undefined,
    activeToolArguments: undefined as Record<string, any> | undefined,
    activeBlockType: undefined as "thought" | "think" | "plan" | undefined,
  });

  useInterval(
    () => {
      if (
        renderedPartialData.content !== partialDataRef.current.content ||
        renderedPartialData.reasoning !== partialDataRef.current.reasoning ||
        renderedPartialData.activeToolName !==
          partialDataRef.current.activeToolName ||
        !isEqual(
          renderedPartialData.activeToolArguments,
          partialDataRef.current.activeToolArguments,
        ) ||
        renderedPartialData.activeBlockType !==
          partialDataRef.current.activeBlockType
      ) {
        setRenderedPartialData({ ...partialDataRef.current });
      }
    },
    loading ? 400 : null,
  );

  const [promptQueue, setPromptQueue] = useState<
    Array<{
      inputs: Array<ChatCompletionMessageParam>;
      prevItems: Array<ChatCompletionMessageParam>;
    }>
  >([]);

  const queuedInputText = useMemo(() => {
    if (promptQueue.length === 0) {
      return "";
    }
    const firstTurn = promptQueue[0];
    if (!firstTurn) {
      return "";
    }
    return firstTurn.inputs
      .map((item) => {
        if (typeof item.content === "string") {
          return item.content;
        }
        if (Array.isArray(item.content)) {
          return item.content
            .map((c) => ("text" in c ? c.text : ""))
            .join("\n");
        }
        return "";
      })
      .join("\n\n");
  }, [promptQueue]);

  const popQueuedInput = () => {
    const text = queuedInputText;
    setPromptQueue([]);
    return text;
  };

  const { requestConfirmation, confirmationPrompt, submitConfirmation } =
    useConfirmation();

  const [initialPrompt, setInitialPrompt] = useState(_initialPrompt);
  const [initialImagePaths, setInitialImagePaths] =
    useState(_initialImagePaths);

  const [refreshKey, setRefreshKey] = useState(0);

  const handleRefresh = () => {
    setRefreshKey((k) => k + 1);
  };

  const handlePin = (path: string) => {
    if (config.pinnedFiles?.includes(path)) {
      setItems((prev) => [
        ...prev,
        { role: "assistant", content: `File is already pinned: ${path}` },
      ]);
      return;
    }
    setConfig((prev) => ({
      ...prev,
      pinnedFiles: [...new Set([...(prev.pinnedFiles || []), path])],
    }));
    setItems((prev) => [
      ...prev,
      { role: "assistant", content: `Pinned file: ${path}` },
    ]);
    setPendingPinAction("pin");
  };

  const handleUnpin = (path: string) => {
    if (!config.pinnedFiles?.includes(path)) {
      setItems((prev) => [
        ...prev,
        { role: "assistant", content: `File is not pinned: ${path}` },
      ]);
      return;
    }
    setConfig((prev) => ({
      ...prev,
      pinnedFiles: (prev.pinnedFiles || []).filter((f) => f !== path),
    }));
    setItems((prev) => [
      ...prev,
      { role: "assistant", content: `Unpinned file: ${path}` },
    ]);
    setPendingPinAction("unpin");
  };

  const handleUndo = async () => {
    if (!agent) {
      return;
    }
    setLoading(true);
    const result = await undoLastChange(
      agent.sessionId,
      (p, c) => fs.writeFileSync(p, c, "utf-8"),
      (p) => {
        if (fs.existsSync(p)) {
          fs.unlinkSync(p);
        }
      },
    );

    if (result.success) {
      setItems(result.items);
      setPrevItems(result.items);
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `🔄 ${result.message}`,
        },
      ]);
    } else {
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `⚠️ ${result.message}`,
        },
      ]);
    }
    setLoading(false);
  };

  const awaitingContinueConfirmation = useMemo(() => {
    const lastItem = items[items.length - 1];
    if (lastItem && lastItem.role === "assistant" && !loading) {
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
  }, [items, loading]);

  // Update terminal title based on state
  useEffect(() => {
    let title = "OpenCodex: Ready";
    if (awaitingContinueConfirmation) {
      title = "⏳ OpenCodex: Question Pending";
      beep();
    } else if (confirmationPrompt) {
      title = "🛡️ OpenCodex: Awaiting Approval";
      beep();
    } else if (loading) {
      if (renderedPartialData.activeToolName) {
        title = `⚙️ OpenCodex: Running ${renderedPartialData.activeToolName}...`;
      } else {
        title = "🧠 OpenCodex: Thinking...";
      }
    }
    setTerminalTitle(title);
  }, [
    loading,
    awaitingContinueConfirmation,
    confirmationPrompt,
    renderedPartialData.activeToolName,
  ]);

  const PWD = React.useMemo(() => shortCwd(), []);

  const pluginManager = React.useMemo(() => new PluginManager(), []);

  useEffect(() => {
    pluginManager.loadPlugins().catch((e) => log(`Failed to load plugins: ${e}`));
  }, [pluginManager]);

  // Keep a single AgentLoop instance alive across renders;
  // recreate only when model/instructions/approvalPolicy/config change.
  const agentRef = React.useRef<AgentLoop | undefined>(undefined);
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
      pluginManager,
      onReset: () => {
        setPrevItems([]);
        setTasks([]);
      },
      onTasksUpdate: (newTasks) => {
        setTasks(newTasks);
      },
      onIndexingStatus: (status) => {
        setIndexingStatus(status);
      },
      onShellFocus: (isFocused) => {
        setShellFocused(isFocused);
      },
      onFileAccess: (path) => {
        setLastFileAccess(path);

        // Smart Context: Track access frequency and auto-pin
        if (config.enableSmartContext) {
          const count = (fileAccessCounts.current[path] || 0) + 1;
          fileAccessCounts.current[path] = count;

          if (count >= 3 && !(config.pinnedFiles || []).includes(path)) {
            setConfig((prev) => ({
              ...prev,
              pinnedFiles: [...new Set([...(prev.pinnedFiles || []), path])],
            }));
            setItems((prev) => [
              ...prev,
              {
                role: "assistant",
                content: `📍 Smart Context: Automatically pinned frequently accessed file: ${path}`,
              },
            ]);
          }
        }
      },
      onPartialUpdate: (
        content: string,
        reasoning?: string,
        activeToolName?: string,
        activeToolArguments?: Record<string, any>,
      ) => {
        partialDataRef.current.content = content;
        if (reasoning) {
          if (activeToolName) {
            partialDataRef.current.reasoning = reasoning;
          } else {
            partialDataRef.current.reasoning += reasoning;
          }
        } else if (content) {
          // Check if we are currently inside an unclosed thought/plan block
          const openTagMatch = content.match(
            /<(thought|think|plan)>(?![\s\S]*<\/\1>)([\s\S]*?)$/i,
          );
          if (openTagMatch) {
            const type = openTagMatch[1]!.toLowerCase() as
              | "thought"
              | "think"
              | "plan";
            partialDataRef.current.activeBlockType = type;
            partialDataRef.current.reasoning = openTagMatch[2]!.trim();
          } else if (partialDataRef.current.activeBlockType) {
            // If we had an active block but the tag is now closed or gone, clear it
            partialDataRef.current.activeBlockType = undefined;
            partialDataRef.current.reasoning = "";
          }
        }
        partialDataRef.current.activeToolName = activeToolName;
        partialDataRef.current.activeToolArguments = activeToolArguments;

        // Set status to 'running' for tool calls being streamed
        if (activeToolName) {
          setItems((prev) => {
            const lastItem = prev[prev.length - 1];
            if (
              lastItem &&
              lastItem.role === "assistant" &&
              lastItem.tool_calls &&
              lastItem.tool_calls.length > 0
            ) {
              // Update the status of the *last* tool call in the *last* assistant message
              // This assumes that streaming updates are always for the most recent tool call
              const updatedToolCalls = lastItem.tool_calls.map((tc) => ({
                ...tc,
                status: 'running',
              }));
              return [
                ...prev.slice(0, prev.length - 1),
                {
                  ...lastItem,
                  tool_calls: updatedToolCalls,
                } as ExtendedChatCompletionMessageParam,
              ];
            }
            return prev;
          });
        }
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

        let newItem: ExtendedChatCompletionMessageParam = item;
        if (item.role === "tool" && !("tool_calls" in item)) {
          const parsedOutput = parseToolCallOutput(item.content as string);
          newItem = {
            ...item,
            status: parsedOutput.metadata?.exit_code === 0 ? 'success' : 'failure',
          } as ExtendedChatCompletionMessageParam;
        } else if (item.role === "assistant" && item.tool_calls) {
          // Mark all tool calls within this assistant message as running initially
          newItem = {
            ...item,
            tool_calls: item.tool_calls.map((tc) => ({
              ...tc,
              status: 'running',
            })),
          } as ExtendedChatCompletionMessageParam;
        }

        // Extract code blocks if this is an assistant message
        if (item.role === "assistant") {
          const content = typeof item.content === "string" ? item.content : "";
          const codeMatches = content.match(/```(?:\w+)?\n([\s\S]*?)(?:```|$)/g);
          if (codeMatches && codeMatches.length > 0) {
            const last = codeMatches[codeMatches.length - 1]!;
            const code = last
              .replace(/```(?:\w+)?\n/, "")
              .replace(/```$/, "")
              .trim();
            setLastCodeBlock(code);
          }
        }

        setItems((prev) => {
          // If it's a streaming tool update, try to update the existing item
          if (item.role === "tool" && "tool_call_id" in item) {
            try {
              const content = JSON.parse(item.content as string);
              if (content.streaming) {
                let existingIndex = -1;
                for (let i = prev.length - 1; i >= 0; i--) {
                  const itemAt = prev[i];
                  if (
                    itemAt?.role === "tool" &&
                    "tool_call_id" in itemAt &&
                    itemAt.tool_call_id === item.tool_call_id
                  ) {
                    existingIndex = i;
                    break;
                  }
                }
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = newItem;
                  return updated;
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }

          const updated = [...prev, newItem];
          saveRollout(updated);
          return updated;
        });
        setPrevItems((prev) => {
          // Same logic for prevItems
          if (item.role === "tool" && "tool_call_id" in item) {
            try {
              const content = JSON.parse(item.content as string);
              if (content.streaming) {
                let existingIndex = -1;
                for (let i = prev.length - 1; i >= 0; i--) {
                  const itemAt = prev[i];
                  if (
                    itemAt?.role === "tool" &&
                    "tool_call_id" in itemAt &&
                    itemAt.tool_call_id === item.tool_call_id
                  ) {
                    existingIndex = i;
                    break;
                  }
                }
                if (existingIndex !== -1) {
                  const updated = [...prev];
                  updated[existingIndex] = newItem;
                  return updated;
                }
              }
            } catch {
              /* ignore parse errors */
            }
          }
          return [...prev, newItem];
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

        // Attach the patch to the request function so it can be passed to the overlay
        (requestConfirmation as any)._pendingApplyPatch = applyPatch;

        const {
          decision: review,
          customDenyMessage,
          updatedApplyPatch,
        } = await requestConfirmation(
          <TerminalChatToolCallCommand
            commandForDisplay={commandForDisplay}
            applyPatch={applyPatch}
            theme={activeTheme}
          />,
        );
        return {
          review,
          customDenyMessage,
          applyPatch: updatedApplyPatch || applyPatch,
        };
      },
      getUserChoice: async (
        prompt: string,
        choices?: Array<string>,
      ): Promise<string> => {
        const { decision } = await requestConfirmation(
          <Box flexDirection="column">
            <Text bold color={activeTheme.warning}>
              {prompt}
            </Text>
          </Box>,
          // @ts-expect-error - requestConfirmation expects 1 argument, but we pass choices too
          choices || ["Yes", "No"],
        );
        return decision;
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
      onShutdown?.(model, items);
      agentRef.current?.terminate();
      agentRef.current = undefined;
      forceUpdate(); // re‑render after teardown too
    };
  }, [model, approvalPolicy, requestConfirmation]);

  // Sync config updates without recreating the agent
  useEffect(() => {
    if (agentRef.current) {
      agentRef.current.updateConfig(config);
    }
  }, [config]);

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

  // Effect to continue agent's turn after a file is pinned or unpinned.
  useEffect(() => {
    const runPendingAction = async () => {
      if (agent && pendingPinAction) {
        const actionText = pendingPinAction === "pin" ? "pinned" : "unpinned";
        const inputItem = await createInputItem(
          `A file has been ${actionText}. Continue processing the original request.`,
          [],
        );
        // Immediately clear the action to prevent re-triggering
        setPendingPinAction(null);
        agent.run([inputItem], items);
      }
    };
    runPendingAction();
  }, [agent, pendingPinAction, items]);

  // ---------------------------------------------------------------------
  // Dynamic layout constraints – keep total rendered rows <= terminal rows
  // ---------------------------------------------------------------------

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
  const batchesRef = React.useRef<
    Array<{
      item?: ChatCompletionMessageParam;
      group?: GroupedResponseItem;
    }>
  >([]);

  const lastMessageBatch = useMemo(() => {
    const batches: Array<{
      item?: ChatCompletionMessageParam;
      group?: GroupedResponseItem;
    }> = [];
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

    // Stabilize objects: if item at index i is the same as before, reuse the object wrapper
    const stabilized = batches.map((batch, i) => {
      const prev = batchesRef.current[i];
      if (
        prev &&
        prev.item === batch.item &&
        prev.group?.items === batch.group?.items
      ) {
        return prev;
      }
      return batch;
    });
    batchesRef.current = stabilized;

    return stabilized;
  }, [items]);

  const groupCounts: Record<string, number> = {};
  const userMsgCount = items.filter((i) => i.role === "user").length;

  const contextLeftPercent = useMemo(
    () => calculateContextPercentRemaining(items, model, config.contextSize),
    [items, model, config.contextSize],
  );

  const [contextHistory, setContextHistory] = useState<Array<number>>([]);

  useEffect(() => {
    const used = 100 - contextLeftPercent;
    setContextHistory((prev) => {
      if (prev[prev.length - 1] === used) {
        return prev;
      }
      return [...prev, used].slice(-20); // Keep last 20 points
    });
  }, [contextLeftPercent]);

  const activeTheme = getTheme(config.theme);

  const memoizedStreamingMessage = useMemo(() => {
    if (
      !loading ||
      (!renderedPartialData.content && !renderedPartialData.reasoning)
    ) {
      return undefined;
    }

    const content = renderedPartialData.content;
    let finalContent = content;

    // If we have separate reasoning from the model (e.g. o1/o3 reasoning_content),
    // always show it wrapped in <thought> at the beginning.
    if (
      renderedPartialData.reasoning &&
      !content.includes(renderedPartialData.reasoning)
    ) {
      finalContent = `<thought>${renderedPartialData.reasoning}</thought>\n${content}`;
    }

    return {
      role: "assistant" as const,
      content: finalContent,
    };
  }, [loading, renderedPartialData.content, renderedPartialData.reasoning]);

  return (
    <Box flexDirection="column">
      {agent ? (
        <TerminalMessageHistory
          batch={lastMessageBatch}
          groupCounts={groupCounts}
          items={items}
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
          applyPatch={
            confirmationPrompt
              ? (requestConfirmation as any)._pendingApplyPatch
              : undefined
          }
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
            initialImagePaths,
            theme: activeTheme,
          }}
          streamingMessage={memoizedStreamingMessage}
          lastFileAccess={lastFileAccess}
          isActive={overlayMode === "none"}
          refreshKey={refreshKey}
          onRefresh={handleRefresh}
        />
      ) : (
        <Box>
          <Text color="gray">Initializing agent…</Text>
        </Box>
      )}

      {tasks.length > 0 && (
        <Box marginTop={1}>
          <TaskChecklist tasks={tasks} theme={activeTheme} />
        </Box>
      )}

      {overlayMode === "none" && agent && (
        <TerminalChatInput
          loading={loading}
          setItems={setItems}
          isNew={Boolean(items.length === 0)}
          setPrevItems={setPrevItems}
          confirmationPrompt={confirmationPrompt}
          openOverlay={() => openOverlay("history")}
          openHistorySelectOverlay={() => openOverlay("history-select")}
          openModelOverlay={() => openOverlay("model")}
          openApprovalOverlay={() => openOverlay("approval")}
          openMemoryOverlay={() => openOverlay("memory")}
          openHelpOverlay={() => openOverlay("help")}
          openConfigOverlay={() => openOverlay("config")}
          openPromptOverlay={() => openOverlay("prompt")}
          openPromptsOverlay={() => openOverlay("prompts")}
          openRecipesOverlay={() => openOverlay("recipes")}
          openCommandPalette={() => openOverlay("palette")}
          openCommandHistory={() => openOverlay("commands")}
          openThemeOverlay={() => openOverlay("theme")}
          onUndo={handleUndo}
          onPin={handlePin}
          onUnpin={handleUnpin}
          onRefresh={handleRefresh}
          onShellFocus={setShellFocused}
          onCopy={() => {
            if (lastCodeBlock) {
              clipboard.writeSync(lastCodeBlock);
              setItems((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "📋 Last code block copied to clipboard.",
                },
              ]);
            }
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
            // If agent is not loading, run immediately. Otherwise, merge into queue.
            if (!loading) {
              agent.run(inputs, prevItems);
            } else {
              setPromptQueue((prev) => {
                if (prev.length === 0) {
                  return [{ inputs, prevItems }];
                }

                const existing = prev[0]!;
                const updatedInputs = [...existing.inputs];
                const nextMsg = inputs[0];

                // Merge text if both are user messages
                if (
                  nextMsg &&
                  nextMsg.role === "user" &&
                  updatedInputs[0]?.role === "user"
                ) {
                  const prevContent =
                    typeof updatedInputs[0].content === "string"
                      ? updatedInputs[0].content
                      : "";
                  const nextContent =
                    typeof nextMsg.content === "string" ? nextMsg.content : "";
                  updatedInputs[0] = {
                    ...updatedInputs[0],
                    content: prevContent + "\n\n" + nextContent,
                  };
                } else {
                  updatedInputs.push(...inputs);
                }

                return [
                  { inputs: updatedInputs, prevItems: existing.prevItems },
                ];
              });
            }
            return {};
          }}
          awaitingContinueConfirmation={awaitingContinueConfirmation}
          theme={activeTheme}
          allFiles={allFiles}
          isStreamingResponse={!!memoizedStreamingMessage}
          queuedInputText={queuedInputText}
          onPopQueuedInput={popQueuedInput}
          contextLeftPercent={contextLeftPercent}
          isShellFocused={shellFocused}
        />
      )}

      {agent && (
        <TerminalStatusBar
          contextLeftPercent={contextLeftPercent}
          contextHistory={contextHistory}
          tokenBreakdown={calculateTokenBreakdown(model, items)}
          sessionId={agent.sessionId}
          approvalPolicy={approvalPolicy}
          theme={activeTheme}
          queuedInputLength={queuedInputText.length}
          indexingStatus={indexingStatus}
        />
      )}
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
            setItems(rollout.items);
            setPrevItems(rollout.items);
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
                content: `Updated editor command to: ${newCommand || "default ($EDITOR)"}`,
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
                content: `Updated SearXNG URL to: ${newUrl || "default (DuckDuckGo fallback)"}`,
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
                content: `Updated generic search URL to: ${newUrl || "default (DuckDuckGo fallback)"}`,
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
                    text: `Switched theme to ${typeof newTheme === "string" ? newTheme : (newTheme as any).name || "custom"}`,
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
    </Box>
  );
}
