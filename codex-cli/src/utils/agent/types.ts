import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import OpenAI from "openai";

export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
};

export type AgentLoopParams = {
  model: string;
  config?: AppConfig;
  instructions?: string;
  approvalPolicy: ApprovalPolicy;
  onItem: (item: ChatCompletionMessageParam) => void;
  onPartialUpdate?: (content: string, reasoning?: string, activeToolName?: string, activeToolArguments?: Record<string, any>) => void;
  onLoading: (loading: boolean) => void;
  onReset: () => void;
  onFileAccess?: (path: string) => void;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
};

export interface AgentContext {
  config: AppConfig;
  approvalPolicy: ApprovalPolicy;
  execAbortController: AbortController | null;
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  onItem: (item: ChatCompletionMessageParam) => void;
  onFileAccess?: (path: string) => void;
  oai: OpenAI;
  model: string;
}

