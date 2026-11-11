import type { ApplyPatchCommand } from "../../approvals.js";
import type { Theme } from "../../utils/theme.js";

import { DiffChanges } from "./diff-changes.js";
import { useAppContext } from "../../contexts/app-context.js";
import { ReviewDecision } from "../../utils/agent/review";
import { openExternalEditor } from "../../utils/input-utils.js";
import { clearTerminal } from "../../utils/terminal.js";

// TODO: figure out why `cli-spinners` fails on Node v20.9.0
// which is why we have to do this in the first place
//
// @ts-expect-error select.js is JavaScript and has no types
import { Select } from "../vendor/ink-select/select";
import TextInput from "../vendor/ink-text-input";
import { Box, Text, useInput } from "ink";
import React from "react";

// default deny‑reason:
const DEFAULT_DENY_MESSAGE =
  "Don't do that, but keep trying to fix the problem";

export function TerminalChatCommandReview({
  confirmationPrompt,
  onReviewCommand,
  allowAlwaysPatch,
  applyPatch,
  theme,
  isActive = true,
  onRefresh,
}: {
  confirmationPrompt: React.ReactNode;
  onReviewCommand: (
    decision: ReviewDecision,
    customMessage?: string,
    updatedApplyPatch?: ApplyPatchCommand,
  ) => void;
  allowAlwaysPatch?: boolean;
  applyPatch?: ApplyPatchCommand;
  theme: Theme;
  isActive?: boolean;
  onRefresh?: () => void;
}): React.ReactElement {
  const [mode, setMode] = React.useState<"select" | "input" | "hunks">(
    "select",
  );
  const [msg, setMsg] = React.useState<string>("");
  const [hunkCursor, setHunkCursor] = React.useState(0);
  const [selectedHunks, setSelectedHunks] = React.useState<Set<number>>(
    new Set(),
  );
  const { config } = useAppContext();

  // -------------------------------------------------------------------------
  // Determine whether the "always approve" option should be displayed.  We
  // only hide it for the special `apply_patch` command since approving those
  // permanently would bypass the user's review of future file modifications.
  // The information is embedded in the `confirmationPrompt` React element –
  // we inspect the `commandForDisplay` prop exposed by
  // <TerminalChatToolCallCommand/> to extract the base command.
  // -------------------------------------------------------------------------

  const showAlwaysApprove = React.useMemo(() => {
    if (allowAlwaysPatch) {
      return true;
    }

    if (
      React.isValidElement(confirmationPrompt) &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (confirmationPrompt as any).props?.commandForDisplay === "string"
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const command: string = (confirmationPrompt as any).props
        .commandForDisplay;
      // Grab the first token of the first line – that corresponds to the base
      // command even when the string contains embedded newlines (e.g. diffs).
      const baseCmd = command.split("\n")[0]?.trim().split(/\s+/)[0] ?? "";
      return baseCmd !== "apply_patch";
    }
    // Default to showing the option when we cannot reliably detect the base
    // command.
    return true;
  }, [confirmationPrompt]);

  // Memoize the list of selectable options to avoid recreating the array on
  // every render.  This keeps <Select/> stable and prevents unnecessary work
  // inside Ink.
  const approvalOptions = React.useMemo(() => {
    const opts: Array<
      | { label: string; value: ReviewDecision }
      | { label: string; value: "edit" }
    > = [
      {
        label: "Yes (y)",
        value: ReviewDecision.YES,
      },
    ];

    if (showAlwaysApprove) {
      opts.push({
        label: "Yes, always approve this exact command for this session (a)",
        value: ReviewDecision.ALWAYS,
      });
    }

    if (applyPatch) {
      opts.push({
        label: "View or Edit patch in $EDITOR (v)",
        value: "view-edit" as any,
      });
      opts.push({
        label: "Select hunks to apply (h)",
        value: "hunks" as any,
      });
    }

    opts.push(
      {
        label: "Edit or give feedback (e)",
        value: "edit",
      },
      {
        label: "No, and keep going (n)",
        value: ReviewDecision.NO_CONTINUE,
      },
      {
        label: "No, and stop for now (esc)",
        value: ReviewDecision.NO_EXIT,
      },
    );

    return opts;
  }, [showAlwaysApprove, applyPatch]);

  const hunks = React.useMemo(() => {
    if (!applyPatch) {return [] as Array<string>;}
    const lines = applyPatch.patch.split("\n");
    const out: Array<string> = [];
    let current: Array<string> = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        if (inHunk && current.length) {out.push(current.join("\n"));}
        current = [line];
        inHunk = true;
      } else if (line.startsWith("*** ")) {
        if (inHunk && current.length) {
          out.push(current.join("\n"));
          current = [];
          inHunk = false;
        }
      } else if (inHunk) {
        current.push(line);
      }
    }
    if (inHunk && current.length) {out.push(current.join("\n"));}
    return out;
  }, [applyPatch]);

  React.useEffect(() => {
    setSelectedHunks(new Set(hunks.map((_, i) => i)));
    setHunkCursor(0);
  }, [hunks]);

  const buildFilteredPatch = React.useCallback(() => {
    if (!applyPatch) {return "";}
    if (selectedHunks.size === hunks.length) {return applyPatch.patch;}
    let result = applyPatch.patch;
    hunks.forEach((h, i) => {
      if (!selectedHunks.has(i)) {
        result = result.replace(h, "");
      }
    });
    return result.replace(/\n{3,}/g, "\n\n");
  }, [applyPatch, hunks, selectedHunks]);

  useInput(
    async (input, key) => {
      if (!isActive) {
        return;
      }

      if (mode === "hunks") {
        if (key.upArrow) {
          setHunkCursor((c) => Math.max(0, c - 1));
        } else if (key.downArrow) {
          setHunkCursor((c) => Math.min(Math.max(0, hunks.length - 1), c + 1));
        } else if (input === " ") {
          setSelectedHunks((prev) => {
            const next = new Set(prev);
            if (next.has(hunkCursor)) {next.delete(hunkCursor);}
            else {next.add(hunkCursor);}
            return next;
          });
        } else if (input === "a") {
          setSelectedHunks(new Set(hunks.map((_, i) => i)));
        } else if (input === "n" || key.escape) {
          setMode("select");
        } else if (key.return) {
          const filtered = buildFilteredPatch();
          onReviewCommand(
            ReviewDecision.YES,
            undefined,
            applyPatch ? { ...applyPatch, patch: filtered } : undefined,
          );
        }
      } else if (mode === "select") {
        if (input === "y") {
          onReviewCommand(ReviewDecision.YES);
        } else if (input === "v" && applyPatch) {
          const edited = await openExternalEditor(applyPatch.patch, config);
          clearTerminal();
          onRefresh?.();
          if (edited && edited !== applyPatch.patch) {
            onReviewCommand(ReviewDecision.YES, undefined, {
              ...applyPatch,
              patch: edited,
            });
          } else {
            // If no changes, just proceed or stay in menu?
            // Let's proceed with original if they just viewed it.
            onReviewCommand(ReviewDecision.YES);
          }
        } else if (input === "e") {
          setMode("input");
        } else if (input === "h" && applyPatch) {
          setMode("hunks");
        } else if (input === "n") {
          onReviewCommand(
            ReviewDecision.NO_CONTINUE,
            "Don't do that, keep going though",
          );
        } else if (input === "a" && showAlwaysApprove) {
          onReviewCommand(ReviewDecision.ALWAYS);
        } else if (key.escape) {
          onReviewCommand(ReviewDecision.NO_EXIT);
        }
      } else {
        // text entry mode
        if (key.return) {
          // if user hit enter on empty msg, fall back to DEFAULT_DENY_MESSAGE
          const custom = msg.trim() === "" ? DEFAULT_DENY_MESSAGE : msg;
          onReviewCommand(ReviewDecision.NO_CONTINUE, custom);
        } else if (key.escape) {
          // treat escape as denial with default message as well
          onReviewCommand(
            ReviewDecision.NO_CONTINUE,
            msg.trim() === "" ? DEFAULT_DENY_MESSAGE : msg,
          );
        }
      }
    },
    { isActive },
  );

  const riskInfo = React.useMemo(() => {
    if (applyPatch) {
      return { label: "⚠ MODIFIES FILES", color: theme.error };
    }
    if (React.isValidElement(confirmationPrompt)) {
      const command: unknown = (confirmationPrompt as any).props
        ?.commandForDisplay;
      const baseCmd =
        typeof command === "string"
          ? (command.split("\n")[0]?.trim().split(/\s+/)[0] ?? "")
          : "";
      const readOnly = [
        "read_file",
        "read_file_lines",
        "search_codebase",
        "semantic_search",
        "list_files",
        "grep",
        "glob",
      ].includes(baseCmd);
      if (readOnly) {return { label: "read-only", color: theme.success };}
    }
    return { label: "⚡ EXECUTES COMMAND", color: theme.warning };
  }, [applyPatch, confirmationPrompt, theme]);

  return (
    <Box
      flexDirection="column"
      gap={0}
      borderStyle="single"
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      paddingLeft={1}
      marginTop={1}
      marginBottom={1}
    >
      {React.isValidElement(confirmationPrompt)
        ? React.cloneElement(confirmationPrompt as React.ReactElement<any>, {
            isActive,
          })
        : confirmationPrompt}
      <Box paddingLeft={1} marginTop={1}>
        <Text color={riskInfo.color}>
          {applyPatch
            ? "· modifies files"
            : riskInfo.label === "read-only"
              ? "· read-only"
              : "· executes command"}
        </Text>
      </Box>
      {applyPatch && (
        <Box flexDirection="column" marginTop={1} paddingLeft={2}>
          <Box gap={1} marginBottom={0}>
            <Text color={theme.dim}>diff preview</Text>
            <DiffChanges
              additions={(applyPatch.patch.match(/^\+(?!\+\+)/gm) || []).length}
              deletions={(applyPatch.patch.match(/^-(?!--)/gm) || []).length}
              theme={theme}
              showBar={false}
            />
          </Box>
          {applyPatch.patch
            .split("\n")
            .slice(0, 14)
            .map((line: string, i: number) => (
              <Text
                key={i}
                color={
                  line.startsWith("+") && !line.startsWith("+++")
                    ? theme.success
                    : line.startsWith("-") && !line.startsWith("---")
                      ? theme.error
                      : theme.dim
                }
              >
                {line.length > 200 ? `${line.slice(0, 200)}…` : line}
              </Text>
            ))}
          {applyPatch.patch.split("\n").length > 14 && (
            <Text color={theme.dim}>…</Text>
          )}
        </Box>
      )}
      <Box flexDirection="column" gap={0} marginTop={1}>
        {mode === "hunks" ? (
          <>
            <Box gap={1} marginBottom={1} paddingLeft={1}>
              <Text color={theme.highlight} bold>
                Select hunks to apply (space toggle, ↵ confirm):
              </Text>
            </Box>
            <Box flexDirection="column" paddingLeft={2}>
              {hunks.map((_, i) => (
                <Box key={i} gap={1}>
                  <Text color={i === hunkCursor ? theme.highlight : theme.dim}>
                    {i === hunkCursor ? "›" : " "}{" "}
                    {selectedHunks.has(i) ? "[x]" : "[ ]"} hunk {i + 1}
                  </Text>
                </Box>
              ))}
              {hunks.length === 0 && (
                <Text color={theme.dim}>No hunks detected.</Text>
              )}
            </Box>
            <Box paddingLeft={2} marginTop={1}>
              <Text color={theme.dim}>
                ↑↓ move · space toggle · a all · ↵ apply selected · esc back
              </Text>
            </Box>
          </>
        ) : mode === "select" ? (
          <>
            <Box gap={1} marginBottom={1} paddingLeft={1}>
              <Text color={theme.highlight} bold>
                Allow command execution?
              </Text>
            </Box>
            <Box
              paddingLeft={2}
              paddingRight={2}
              flexDirection="column"
              gap={0}
            >
              <Select
                theme={theme}
                isDisabled={!isActive}
                onChange={async (
                  value: ReviewDecision | "edit" | "view-edit" | "hunks",
                ) => {
                  if (value === "edit") {
                    setMode("input");
                  } else if (value === "hunks" && applyPatch) {
                    setMode("hunks");
                  } else if (value === "view-edit" && applyPatch) {
                    const edited = await openExternalEditor(
                      applyPatch.patch,
                      config,
                    );
                    clearTerminal();
                    onRefresh?.();
                    if (edited && edited !== applyPatch.patch) {
                      onReviewCommand(ReviewDecision.YES, undefined, {
                        ...applyPatch,
                        patch: edited,
                      });
                    } else {
                      onReviewCommand(ReviewDecision.YES);
                    }
                  } else {
                    onReviewCommand(value as ReviewDecision);
                  }
                }}
                options={approvalOptions as any}
              />
              <Box paddingLeft={2} marginTop={1}>
                <Text color={theme.dim}>
                  y approve · a always · v view/edit · e feedback · n deny · esc
                  stop
                </Text>
              </Box>
            </Box>
          </>
        ) : (
          <>
            <Box gap={1} marginBottom={1} paddingLeft={1}>
              <Text color={theme.highlight} bold>
                Give the model feedback (↵ to submit):
              </Text>
            </Box>
            <Box
              borderStyle="single"
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderLeftColor={theme.accent}
              paddingLeft={2}
              marginLeft={1}
            >
              <TextInput
                value={msg}
                onChange={setMsg}
                placeholder="type a reason"
                showCursor
                focus={isActive}
              />
            </Box>

            {msg.trim() === "" && (
              <Box
                paddingLeft={3}
                paddingRight={3}
                marginTop={1}
                marginBottom={1}
              >
                <Text dimColor italic>
                  Default: "{DEFAULT_DENY_MESSAGE}"
                </Text>
              </Box>
            )}
          </>
        )}
      </Box>
    </Box>
  );
}
