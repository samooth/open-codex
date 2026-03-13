import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpManager } from "../src/utils/agent/mcp-manager.js";

// Mock the MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
  return {
    Client: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      getServerCapabilities: vi.fn().mockReturnValue({
        resources: {},
        prompts: {},
      }),
      listTools: vi.fn().mockResolvedValue({
        tools: [
          {
            name: "test_tool",
            description: "A test tool",
            inputSchema: {
              type: "object",
              properties: {
                arg1: { type: "string" },
              },
            },
          },
        ],
      }),
      listResources: vi.fn().mockResolvedValue({
        resources: [
          { name: "test_resource", uri: "test://uri", description: "A test resource" },
        ],
      }),
      readResource: vi.fn().mockResolvedValue({
        contents: [{ text: "resource content" }],
      }),
      listPrompts: vi.fn().mockResolvedValue({
        prompts: [
          { name: "test_prompt", description: "A test prompt" },
        ],
      }),
      getPrompt: vi.fn().mockResolvedValue({
        messages: [
          { role: "user", content: { text: "prompt content" } },
        ],
      }),
      callTool: vi.fn().mockResolvedValue({
        content: [{ text: "tool output" }],
      }),
      close: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => {
  return {
    StdioClientTransport: vi.fn().mockImplementation(() => ({})),
  };
});

// Mock logging
vi.mock("../src/utils/agent/log.js", () => ({
  log: vi.fn(),
}));

describe("McpManager", () => {
  let mcpManager: McpManager;

  beforeEach(() => {
    mcpManager = new McpManager();
    vi.clearAllMocks();
  });

  it("should connect to servers and load tools, resources, and prompts", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
        args: ["--arg"],
      },
    };

    await mcpManager.connectServers(servers);

    const definitions = mcpManager.getAllDefinitions();
    
    // 1 tool + 2 resource tools + 2 prompt tools = 5 tools
    expect(definitions).toHaveLength(5);
    
    const names = definitions.map(d => d.function.name);
    expect(names).toContain("test_server_test_tool");
    expect(names).toContain("test_server_list_resources");
    expect(names).toContain("test_server_read_resource");
    expect(names).toContain("test_server_list_prompts");
    expect(names).toContain("test_server_get_prompt");
  });

  it("should call a tool correctly", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
      },
    };
    await mcpManager.connectServers(servers);

    const output = await mcpManager.callTool("test_server_test_tool", { arg1: "val" });
    expect(output).toBe("tool output");
  });

  it("should list resources correctly", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
      },
    };
    await mcpManager.connectServers(servers);

    const output = await mcpManager.callTool("test_server_list_resources", {});
    expect(output).toContain("test_resource (test://uri)");
  });

  it("should read a resource correctly", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
      },
    };
    await mcpManager.connectServers(servers);

    const output = await mcpManager.callTool("test_server_read_resource", { uri: "test://uri" });
    expect(output).toBe("resource content");
  });

  it("should list prompts correctly", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
      },
    };
    await mcpManager.connectServers(servers);

    const output = await mcpManager.callTool("test_server_list_prompts", {});
    expect(output).toContain("test_prompt");
  });

  it("should get a prompt correctly", async () => {
    const servers = {
      test_server: {
        command: "test-cmd",
      },
    };
    await mcpManager.connectServers(servers);

    const output = await mcpManager.callTool("test_server_get_prompt", { name: "test_prompt" });
    expect(output).toBe("[user] prompt content");
  });
});
