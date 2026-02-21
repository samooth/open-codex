import { ReviewDecision } from "../../utils/agent/review";
import { openExternalEditor } from "../../utils/input-utils.js";
import { clearTerminal } from "../../utils/terminal.js";
import type { ApplyPatchCommand } from "../../approvals.js";
import type { Theme } from "../../utils/theme.js";
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
  onReviewCommand: (decision: ReviewDecision, customMessage?: string, updatedApplyPatch?: ApplyPatchCommand) => void;
  allowAlwaysPatch?: boolean;
  applyPatch?: ApplyPatchCommand;
  theme: Theme;
  isActive?: boolean;
  onRefresh?: () => void;
}): React.ReactElement {
  const [mode, setMode] = React.useState<"select" | "input">("select");
  const [msg, setMsg] = React.useState<string>("");

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

  useInput(async (input, key) => {
    if (!isActive) return;

    if (mode === "select") {
      if (input === "y") {
        onReviewCommand(ReviewDecision.YES);
      } else if (input === "v" && applyPatch) {
        const edited = await openExternalEditor(applyPatch.patch);
        clearTerminal();
        onRefresh?.();
        if (edited && edited !== applyPatch.patch) {
          onReviewCommand(ReviewDecision.YES, undefined, { ...applyPatch, patch: edited });
        } else {
          // If no changes, just proceed or stay in menu? 
          // Let's proceed with original if they just viewed it.
          onReviewCommand(ReviewDecision.YES);
        }
      } else if (input === "e") {
        setMode("input");
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
  }, { isActive });

  return (
    <Box 
      flexDirection="column" 
      gap={0} 
      borderStyle="bold" 
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftColor={theme.highlight}
      paddingLeft={1}
      marginTop={1}
      marginBottom={1}
    >
      {React.isValidElement(confirmationPrompt) 
        ? React.cloneElement(confirmationPrompt as React.ReactElement<any>, { isActive }) 
        : confirmationPrompt}
      <Box flexDirection="column" gap={0} marginTop={1}>
        {mode === "select" ? (
          <>
            <Box gap={1} marginBottom={1} paddingLeft={1}>
              <Text bold color={theme.highlight} inverse paddingLeft={1} paddingRight={1}> PROMPT </Text>
              <Text color={theme.highlight} bold>Allow command execution?</Text>
            </Box>
            <Box paddingLeft={2} paddingRight={2} flexDirection="column" gap={0}>
              <Select
                theme={theme}
                isDisabled={!isActive}
                onChange={async (value: ReviewDecision | "edit" | "view-edit") => {
                  if (value === "edit") {
                    setMode("input");
                  } else if (value === "view-edit" && applyPatch) {
                    const edited = await openExternalEditor(applyPatch.patch);
                    clearTerminal();
                    onRefresh?.();
                    if (edited && edited !== applyPatch.patch) {
                      onReviewCommand(ReviewDecision.YES, undefined, { ...applyPatch, patch: edited });
                    } else {
                      onReviewCommand(ReviewDecision.YES);
                    }
                  } else {
                    onReviewCommand(value as ReviewDecision);
                  }
                }}
                options={approvalOptions as any}
              />
            </Box>
          </>
        ) : (
          <>
            <Box gap={1} marginBottom={1} paddingLeft={1}>
              <Text bold color={theme.highlight} inverse paddingLeft={1} paddingRight={1}> FEEDBACK </Text>
              <Text color={theme.highlight} bold>Give the model feedback (↵ to submit):</Text>
            </Box>
            <Box 
              borderStyle="bold" 
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
              <Box paddingLeft={3} paddingRight={3} marginTop={1} marginBottom={1}>
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
