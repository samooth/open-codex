import type { ApprovalPolicy } from "./approvals";
import type { AppConfig } from "./utils/config";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

export type MessageStatus = 'running' | 'success' | 'failure';

export type ExtendedChatCompletionMessageParam =
  ChatCompletionMessageParam & {
    status?: MessageStatus;
  };

import TerminalChat from "./components/chat/terminal-chat";
import TerminalChatPastRollout from "./components/chat/terminal-chat-past-rollout";
import { TerminalSizeProvider } from "./contexts/terminal-size-context.js";
import { AppProvider } from "./contexts/app-context.js";
import { checkInGit } from "./utils/check-in-git.js";
import { type TerminalChatSession } from "./utils/session.js";
import { onExit } from "./utils/terminal";
import { getTheme } from "./utils/theme";
import { ConfirmInput } from "@inkjs/ui";
import chalk from "chalk";
import { Box, Text, useApp, useStdin } from "ink";
import React, { useMemo, useState } from "react";

export type AppRollout = {
  session: TerminalChatSession;
  items: Array<ExtendedChatCompletionMessageParam>;
  onShutdown?: (
    model: string,
    items: Array<ExtendedChatCompletionMessageParam>,
  ) => void;
};

type Props = {
  prompt?: string;
  config: AppConfig;
  imagePaths?: Array<string>;
  rollout?: AppRollout;
  approvalPolicy: ApprovalPolicy;
  fullStdout: boolean;
  onShutdown?: (
    model: string,
    items: Array<ExtendedChatCompletionMessageParam>,
  ) => void;
};

export default function App({
  prompt,
  config,
  rollout,
  imagePaths,
  approvalPolicy,
  fullStdout,
  onShutdown,
}: Props): React.ReactElement {
  const app = useApp();
  const [accepted, setAccepted] = useState(() => false);
  const [cwd, inGitRepo] = useMemo(
    () => [process.cwd(), checkInGit(process.cwd())],
    [],
  );
  const { internal_eventEmitter } = useStdin();
  internal_eventEmitter.setMaxListeners(20);

  const activeTheme = useMemo(() => getTheme(config.theme), [config.theme]);

  if (rollout) {
    return (
      <TerminalChatPastRollout
        session={rollout.session}
        items={rollout.items}
        theme={activeTheme}
      />
    );
  }

  if (!inGitRepo && !accepted) {
    const warningTitle = chalk.yellow.bold(" DANGER ");
    const warningMessage = chalk.white(
      `You are running OpenCodex in a directory that is not a Git repository.`,
    );
    const adviceMessage = chalk.gray(
      `It is highly recommended to use a version control system like Git to track changes and prevent accidental data loss.`,
    );

    return (
      <Box flexDirection="column" padding={1}>
        <Box
          borderStyle="round"
          borderColor="yellow"
          paddingX={2}
          flexDirection="column"
          gap={1}
        >
          <Text>{warningTitle}</Text>
          <Text>{warningMessage}</Text>
          <Text>
            <Text bold>Current Directory:</Text> {chalk.cyan(cwd)}
          </Text>
          <Box height={1} />
          <Text>{adviceMessage}</Text>
          <Box height={1} />
          <Text>Are you sure you want to continue?</Text>
          <ConfirmInput
            defaultChoice="cancel"
            onCancel={() => {
              app.exit();
              onExit();
            }}
            onConfirm={() => setAccepted(true)}
          />
        </Box>
      </Box>
    );
  }

  return (
    <AppProvider initialConfig={config}>
      <TerminalSizeProvider>
        <TerminalChat
          prompt={prompt}
          imagePaths={imagePaths}
          approvalPolicy={approvalPolicy}
          fullStdout={fullStdout}
          onShutdown={onShutdown}
        />
      </TerminalSizeProvider>
    </AppProvider>
  );
}
