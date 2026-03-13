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
import { createInputItem } from "../../utils/input-utils.js";
import { detectInteraction } from "../../utils/interactive-detection.js";
import { listAllFiles } from "../../utils/list-all-files.js";
import { CLI_VERSION } from "../../utils/session.js";
import { parseToolCallOutput } from "../../utils/parsers.js";
import { shortCwd } from "../../utils/short-path.js";
import {
  saveRollout,
  undoLastChange,
} from "../../utils/storage/save-rollout.js";
import { setTerminalTitle, beep, clearTerminal } from "../../utils/terminal.js";
import { getTheme } from "../../utils/theme.js";
import TerminalChatOverlays from "./terminal-chat-overlays.js";
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
  const { config, setConfig, overlayMode, openOverlay } =
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
    loading ? 100 : null,
  );

  const [promptQueue, setPromptQueue] = useState<
    Array<{
      inputs: Array<ChatCompletionMessageParam>;
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
  const wasAgentReady = React.useRef(false);
  useEffect(() => {
    if (agent && !wasAgentReady.current) {
      clearTerminal();
      handleRefresh();
      wasAgentReady.current = true;
    }
  }, [agent]);

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
        agent.run(nextPrompt.inputs, prevItems);
      }
    }
  }, [agent, loading, promptQueue, prevItems]);

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

  const streamingStatus = useMemo(() => {
    if (!loading) {
      return undefined;
    }
    const { activeToolName, reasoning, activeBlockType } = renderedPartialData;
    if (!activeToolName && !reasoning) {
      return undefined;
    }
    return {
      toolName: activeToolName,
      reasoning: reasoning?.trim() || undefined,
      blockType: activeBlockType,
    };
  }, [loading, renderedPartialData]);

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
          streamingStatus={streamingStatus}
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
          partialContent={renderedPartialData.content}
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
                  return [{ inputs }];
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
                  { inputs: updatedInputs },
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
      <TerminalChatOverlays
        model={model}
        setModel={setModel}
        items={items}
        setItems={setItems}
        prevItems={prevItems}
        setPrevItems={setPrevItems}
        approvalPolicy={approvalPolicy}
        setApprovalPolicy={setApprovalPolicy}
        handleUndo={handleUndo}
        agent={agent}
        activeTheme={activeTheme}
        handleRefresh={handleRefresh}
        setInitialPrompt={setInitialPrompt}
      />
    </Box>
  );
}
