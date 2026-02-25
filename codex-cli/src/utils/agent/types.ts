import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";


export type CommandConfirmation = {
  review: ReviewDecision;
  applyPatch?: ApplyPatchCommand | undefined;
  customDenyMessage?: string;
};

export type Task = {
  label: string;
  status: "todo" | "in-progress" | "done";
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
  onTasksUpdate?: (tasks: Array<Task>) => void;
  onIndexingStatus?: (status: { indexing: boolean; current?: number; total?: number; file?: string }) => void;
  onShellFocus?: (isFocused: boolean) => void;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;

  getUserChoice?: (prompt: string, choices?: Array<string>) => Promise<string>;
};

export interface AgentContext {
  config: AppConfig;
  approvalPolicy: ApprovalPolicy;
  execAbortController: AbortController | null;
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  getUserChoice?: (prompt: string, choices?: Array<string>) => Promise<string>;
  onItem: (item: ChatCompletionMessageParam) => void;
  onFileAccess?: (path: string) => void;
  onTasksUpdate?: (tasks: Array<Task>) => void;
  onShellFocus?: (isFocused: boolean) => void;
  oai: OpenAI;
  model: string;
  agent: any; // Add reference to AgentLoop
}

