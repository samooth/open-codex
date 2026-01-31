import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { CommandConfirmation } from "../../utils/agent/agent-loop.js";
import type { AppConfig } from "../../utils/config.js";
import type { ColorName } from "chalk";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";
import type { ReviewDecision } from "src/utils/agent/review.ts";

import TerminalChatInput from "./terminal-chat-input.js";
import { TerminalChatToolCallCommand } from "./terminal-chat-tool-call-item.js";
import { calculateContextPercentRemaining } from "./terminal-chat-utils.js";
import TerminalMessageHistory from "./terminal-message-history.js";
import { formatCommandForDisplay } from "../../format-command.js";
import { useConfirmation } from "../../hooks/use-confirmation.js";
import { useTerminalSize } from "../../hooks/use-terminal-size.js";
import { AgentLoop } from "../../utils/agent/agent-loop.js";
import { log, isLoggingEnabled } from "../../utils/agent/log.js";
import { prefix } from "../../utils/agent/system-prompt.js";
import { createInputItem } from "../../utils/input-utils.js";
import { CLI_VERSION } from "../../utils/session.js";
import { shortCwd } from "../../utils/short-path.js";
import { saveRollout } from "../../utils/storage/save-rollout.js";
import ApprovalModeOverlay from "../approval-mode-overlay.js";
import HelpOverlay from "../help-overlay.js";
import HistoryOverlay from "../history-overlay.js";
import ModelOverlay from "../model-overlay.js";
import ConfigOverlay from "../config-overlay.js";
import PromptOverlay from "../prompt-overlay.js";
import { Box, Text } from "ink";
import React, { useEffect, useMemo, useState } from "react";
import { inspect } from "util";

type Props = {
  config: AppConfig;
  prompt?: string;
  imagePaths?: Array<string>;
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
  approvalPolicy: initialApprovalPolicy,
  fullStdout,
}: Props): React.ReactElement {
  const [config, setConfig] = useState<AppConfig>(initialConfig);
  const [model, setModel] = useState<string>(config.model);
  const [prevItems, setPrevItems] = useState<Array<ChatCompletionMessageParam>>(
    [],
  );
  const [items, setItems] = useState<Array<ChatCompletionMessageParam>>([]);
  const [loading, setLoading] = useState<boolean>(false);
  // Allow switching approval modes at runtime via an overlay.
  const [approvalPolicy, setApprovalPolicy] = useState<ApprovalPolicy>(
    initialApprovalPolicy,
  );
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const { requestConfirmation, confirmationPrompt, submitConfirmation } =
    useConfirmation();
  const [overlayMode, setOverlayMode] = useState<
    "none" | "history" | "model" | "approval" | "help" | "config" | "prompt"
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
      return content.includes(
        "**Continue?** Would you like me to proceed in a specific order?",
      );
    }
    return false;
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
      onReset: () => setPrevItems([]),
      onItem: (item) => {
        log(`onItem: ${JSON.stringify(item)}`);
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
      onLoading: setLoading,
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

  // whenever loading starts/stops, reset or start a timer — but pause the
  // timer while a confirmation overlay is displayed so we don't trigger a
  // re‑render every second during apply_patch reviews.
  useEffect(() => {
    let handle: ReturnType<typeof setInterval> | null = null;
    // Only tick the "thinking…" timer when the agent is actually processing
    // a request *and* the user is not being asked to review a command.
    if (loading && confirmationPrompt == null) {
      setThinkingSeconds(0);
      handle = setInterval(() => {
        setThinkingSeconds((s) => s + 1);
      }, 1000);
    } else {
      if (handle) {
        clearInterval(handle);
      }
      setThinkingSeconds(0);
    }
    return () => {
      if (handle) {
        clearInterval(handle);
      }
    };
  }, [loading, confirmationPrompt]);

  // Let's also track whenever the ref becomes available
  const agent = agentRef.current;
  useEffect(() => {
    if (isLoggingEnabled()) {
      log(`agentRef.current is now ${Boolean(agent)}`);
    }
  }, [agent]);

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

  // Just render every item in order, no grouping/collapse
  const lastMessageBatch = items.map((item) => ({ item }));
  const groupCounts: Record<string, number> = {};
  const userMsgCount = items.filter((i) => i.role === "user").length;

  const contextLeftPercent = useMemo(
    () => calculateContextPercentRemaining(items, model),
    [items, model],
  );

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {agent ? (
          <TerminalMessageHistory
            batch={lastMessageBatch}
            groupCounts={groupCounts}
            items={items}
            userMsgCount={userMsgCount}
            confirmationPrompt={confirmationPrompt}
            loading={loading}
            thinkingSeconds={thinkingSeconds}
            fullStdout={fullStdout}
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
            contextLeftPercent={contextLeftPercent}
            openOverlay={() => setOverlayMode("history")}
            openModelOverlay={() => setOverlayMode("model")}
            openApprovalOverlay={() => setOverlayMode("approval")}
            openHelpOverlay={() => setOverlayMode("help")}
            openConfigOverlay={() => setOverlayMode("config")}
            openPromptOverlay={() => setOverlayMode("prompt")}
            active={overlayMode === "none"}
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
            submitInput={(inputs) => {
              agent.run(inputs, prevItems);
              return {};
            }}
            allowAlwaysPatch={config.allowAlwaysPatch}
            awaitingContinueConfirmation={awaitingContinueConfirmation}
          />
        )}
        {overlayMode === "history" && (
          <HistoryOverlay items={items} onExit={() => setOverlayMode("none")} />
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
            onExit={() => setOverlayMode("none")}
          />
        )}

        {overlayMode === "prompt" && (
          <PromptOverlay
            currentInstructions={
              config.instructions?.includes("You are operating as and within OpenCodex")
                ? config.instructions
                : [prefix, config.instructions].filter(Boolean).join("\n\n")
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
      </Box>
    </Box>
  );
}
