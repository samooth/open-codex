import { describe, expect, it, vi, beforeEach } from "vitest";

// Capture the parameters that AgentLoop sends to `openai.chat.completions.create()`
let lastCreateParams: any = null;

// Mock the stream
class FakeStream {
  public controller = { abort: vi.fn() };
  async *[Symbol.asyncIterator]() {
    yield {
      id: "test",
      choices: [{ delta: { content: "done" }, finish_reason: "stop" }],
    } as any;
  }
}

vi.mock("openai", () => {
  class FakeOpenAI {
    public chat = {
      completions: {
        create: vi.fn((params: any) => {
          lastCreateParams = params;
          return new FakeStream();
        }),
      },
    };
  }
  return {
    __esModule: true,
    default: FakeOpenAI,
    APIConnectionTimeoutError: class extends Error {},
  };
});

// Mock dependencies that we don't need for this test
vi.mock("../src/approvals.js", () => ({
  __esModule: true,
  canAutoApprove: () => ({ type: "auto-approve", runInSandbox: false }),
  alwaysApprovedCommands: new Set<string>(),
  isSafeCommand: () => null,
}));

vi.mock("../src/utils/agent/log.js", () => ({
  __esModule: true,
  log: () => {},
  isLoggingEnabled: () => false,
}));

vi.mock("../src/format-command.js", () => ({
  __esModule: true,
  formatCommandForDisplay: (cmd: Array<string>) => cmd.join(" "),
}));

import { AgentLoop } from "../src/utils/agent/agent-loop.js";
import { PluginManager } from "../src/utils/agent/plugin-manager.js";

describe("AgentLoop Custom Parameters", () => {
  beforeEach(() => {
    lastCreateParams = null;
  });

  it("passes extraBody from provider config to OpenAI create call", async () => {
    const extraBody = {
      options: {
        num_ctx: 8192,
        temperature: 0.1,
      },
    };

    const config: any = {
      model: "llama3",
      provider: "ollama",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      instructions: "",
      providers: {
        ollama: {
          extraBody: extraBody,
        },
      },
    };

    const agent = new AgentLoop({
      pluginManager: new PluginManager(),
      model: config.model,
      instructions: config.instructions,
      config,
      approvalPolicy: { mode: "suggest" } as any,
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onReset: () => {},
    });

    await agent.run([
      {
        role: "user",
        content: [{ type: "text", text: "ping" }],
      },
    ]);

    expect(lastCreateParams).not.toBeNull();
    expect(lastCreateParams.extra_body).toEqual(extraBody);
  });

  it("passes temperature from config to OpenAI create call", async () => {
    const config: any = {
      model: "llama3",
      provider: "ollama",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      instructions: "",
      temperature: 0.5,
    };

    const agent = new AgentLoop({
      pluginManager: new PluginManager(),
      model: config.model,
      instructions: config.instructions,
      config,
      approvalPolicy: { mode: "suggest" } as any,
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onReset: () => {},
    });

    await agent.run([
      {
        role: "user",
        content: [{ type: "text", text: "ping" }],
      },
    ]);

    expect(lastCreateParams).not.toBeNull();
    expect(lastCreateParams.temperature).toBe(0.5);
  });

  it("passes Ollama specific options to OpenAI create call", async () => {
    const config: any = {
      model: "llama3",
      provider: "ollama",
      baseURL: "http://localhost:11434/v1",
      apiKey: "ollama",
      instructions: "",
      topK: 40,
      repeatPenalty: 1.1,
      contextSize: 16384,
    };

    const agent = new AgentLoop({
      pluginManager: new PluginManager(),
      model: config.model,
      instructions: config.instructions,
      config,
      approvalPolicy: { mode: "suggest" } as any,
      onItem: () => {},
      onLoading: () => {},
      getCommandConfirmation: async () => ({ review: "yes" }) as any,
      onReset: () => {},
    });

    await agent.run([
      {
        role: "user",
        content: [{ type: "text", text: "ping" }],
      },
    ]);

    expect(lastCreateParams).not.toBeNull();
    expect(lastCreateParams.extra_body.options).toEqual({
      top_k: 40,
      repeat_penalty: 1.1,
      num_ctx: 16384,
    });
  });
});
