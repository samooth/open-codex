import type { ReviewDecision } from "./review.js";
import type { ApplyPatchCommand, ApprovalPolicy } from "../../approvals.js";
import type { AppConfig } from "../config.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions.mjs";

import OpenAI from "openai";
import type { PluginRegistry } from "../plugins/plugin-registry.js";

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
  onTasksUpdate?: (tasks: Task[]) => void;
  onIndexingStatus?: (status: { indexing: boolean; current?: number; total?: number; file?: string }) => void;
  onShellFocus?: (isFocused: boolean) => void;
  pluginRegistry?: PluginRegistry;

  /** Called when the command is not auto-approved to request explicit user review. */
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;

  getUserChoice?: (prompt: string, choices?: string[]) => Promise<string>;
};

export interface AgentContext {
  config: AppConfig;
  approvalPolicy: ApprovalPolicy;
  execAbortController: AbortController | null;
  getCommandConfirmation: (
    command: Array<string>,
    applyPatch: ApplyPatchCommand | undefined,
  ) => Promise<CommandConfirmation>;
  getUserChoice?: (prompt: string, choices?: string[]) => Promise<string>;
  onItem: (item: ChatCompletionMessageParam) => void;
  onFileAccess?: (path: string) => void;
  onTasksUpdate?: (tasks: Task[]) => void;
  onShellFocus?: (isFocused: boolean) => void;
  pluginRegistry: PluginRegistry;
  oai: OpenAI;
  model: string;
  agent: any; // Add reference to AgentLoop
}

export type ToolResult = {
  outputText: string;
  metadata: Record<string, unknown>;
  additionalItems?: Array<ChatCompletionMessageParam>;
};

export interface PluginContext extends Omit<AgentContext, "agent"> {
  // restricted context for plugins
}

export interface CodexPlugin {
  name: string;
  version: string;
  description?: string;
  /** Tool definitions following OpenAI tool schema. */
  tools: any[]; 
  /** Handler functions for each tool defined above. */
  handlers: Record<string, (args: any, ctx: PluginContext) => Promise<ToolResult>>;
  /** Optional custom prompt instructions to be injected into the system prompt. */
  systemInstructions?: string;
}

