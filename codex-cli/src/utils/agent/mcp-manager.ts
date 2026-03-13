import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { log } from "./log.js";
import type { ChatCompletionTool } from "openai/resources/chat/completions.mjs";
import type { McpServerConfig } from "../config.js";

export type McpToolInfo = {
  serverName: string;
  originalName: string;
  type: "tool" | "resource_list" | "resource_read" | "prompt_list" | "prompt_get";
  definition: ChatCompletionTool;
};

export class McpManager {
  private clients: Map<string, Client> = new Map();
  private tools: Map<string, McpToolInfo> = new Map();

  public async connectServers(servers: Record<string, McpServerConfig> = {}) {
    const promises = Object.entries(servers).map(async ([name, config]) => {
      try {
        log(`Connecting to MCP server: ${name}...`);
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...(process.env as Record<string, string>), ...(config.env || {}) },
          stderr: "pipe",
        });

        if (transport.stderr) {
          transport.stderr.on("data", (chunk) => {
            log(`[MCP Server ${name}] ${chunk.toString().trim()}`);
          });
        }
        const client = new Client(
          {
            name: "open-codex",
            version: "1.0.0",
          },
          {
            capabilities: {
              resources: {},
              prompts: {},
            },
          }
        );
        await client.connect(transport);
        this.clients.set(name, client);

        const capabilities = client.getServerCapabilities();

        // 1. Load Tools
        const toolsResult = await client.listTools();
        for (const tool of toolsResult.tools) {
          const functionName = `${name}_${tool.name}`.replace(/[^a-zA-Z0-9_-]/g, "_");
          this.tools.set(functionName, {
            serverName: name,
            originalName: tool.name,
            type: "tool",
            definition: {
              type: "function",
              function: {
                name: functionName,
                description: tool.description || `Tool ${tool.name} from MCP server ${name}`,
                parameters: tool.inputSchema as any,
              },
            },
          });
        }

        // 2. Load Resources (if supported)
        if (capabilities?.resources) {
          const listName = `${name}_list_resources`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const readName = `${name}_read_resource`.replace(/[^a-zA-Z0-9_-]/g, "_");

          this.tools.set(listName, {
            serverName: name,
            originalName: "list_resources",
            type: "resource_list",
            definition: {
              type: "function",
              function: {
                name: listName,
                description: `List available resources from MCP server ${name}`,
                parameters: {
                  type: "object",
                  properties: {},
                },
              },
            },
          });

          this.tools.set(readName, {
            serverName: name,
            originalName: "read_resource",
            type: "resource_read",
            definition: {
              type: "function",
              function: {
                name: readName,
                description: `Read the content of a resource from MCP server ${name}`,
                parameters: {
                  type: "object",
                  properties: {
                    uri: {
                      type: "string",
                      description: "The URI of the resource to read",
                    },
                  },
                  required: ["uri"],
                },
              },
            },
          });
        }

        // 3. Load Prompts (if supported)
        if (capabilities?.prompts) {
          const listName = `${name}_list_prompts`.replace(/[^a-zA-Z0-9_-]/g, "_");
          const getName = `${name}_get_prompt`.replace(/[^a-zA-Z0-9_-]/g, "_");

          this.tools.set(listName, {
            serverName: name,
            originalName: "list_prompts",
            type: "prompt_list",
            definition: {
              type: "function",
              function: {
                name: listName,
                description: `List available prompts from MCP server ${name}`,
                parameters: {
                  type: "object",
                  properties: {},
                },
              },
            },
          });

          this.tools.set(getName, {
            serverName: name,
            originalName: "get_prompt",
            type: "prompt_get",
            definition: {
              type: "function",
              function: {
                name: getName,
                description: `Get a prompt from MCP server ${name}`,
                parameters: {
                  type: "object",
                  properties: {
                    name: {
                      type: "string",
                      description: "The name of the prompt to retrieve",
                    },
                    arguments: {
                      type: "object",
                      description: "Optional arguments for the prompt",
                      additionalProperties: true,
                    },
                  },
                  required: ["name"],
                },
              },
            },
          });
        }

        log(`Connected to MCP server ${name} and loaded ${toolsResult.tools.length} tools.`);
      } catch (e) {
        log(`Failed to connect to MCP server ${name}: ${e}`);
      }
    });

    await Promise.allSettled(promises);
  }

  public getAllDefinitions(): Array<ChatCompletionTool> {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  public getConnectedServers(): string {
    if (this.clients.size === 0) {
      return "";
    }
    return `Connected MCP Servers: ${Array.from(this.clients.keys()).join(", ")}`;
  }

  public hasTool(name: string): boolean {
    return this.tools.has(name);
  }

  public async callTool(name: string, args: any): Promise<string> {
    const toolInfo = this.tools.get(name);
    if (!toolInfo) {
      throw new Error(`Tool ${name} not found`);
    }
    const client = this.clients.get(toolInfo.serverName);
    if (!client) {
      throw new Error(`Client for MCP server ${toolInfo.serverName} not found`);
    }

    let result: any;
    switch (toolInfo.type) {
      case "tool":
        result = await client.callTool({
          name: toolInfo.originalName,
          arguments: args,
        });
        break;
      case "resource_list":
        result = await client.listResources();
        break;
      case "resource_read":
        result = await client.readResource({
          uri: args.uri,
        });
        break;
      case "prompt_list":
        result = await client.listPrompts();
        break;
      case "prompt_get":
        result = await client.getPrompt({
          name: args.name,
          arguments: args.arguments,
        });
        break;
      default:
        throw new Error(`Unknown tool type: ${toolInfo.type}`);
    }

    if (result.isError) {
      return `Error: ${JSON.stringify(result.content)}`;
    }

    // Format results based on type
    if (toolInfo.type === "resource_list") {
      return (result.resources as Array<any>)
        .map((r: any) => `- ${r.name} (${r.uri}): ${r.description || "No description"}`)
        .join("\n");
    }

    if (toolInfo.type === "prompt_list") {
      return (result.prompts as Array<any>)
        .map((p: any) => `- ${p.name}: ${p.description || "No description"}`)
        .join("\n");
    }

    if (toolInfo.type === "prompt_get") {
      return (result.messages as Array<any>)
        .map((m: any) => `[${m.role}] ${m.content.text || JSON.stringify(m.content)}`)
        .join("\n");
    }

    // Default formatting for tools and resource content
    const contents = result.content || result.contents || [];
    return (contents as Array<any>).map((c: any) => c.text || JSON.stringify(c)).join("\n");
  }

  public async shutdown() {
    const promises = Array.from(this.clients.entries()).map(async ([name, client]) => {
      try {
        await client.close();
      } catch (e) {
        log(`Error closing MCP client ${name}: ${e}`);
      }
    });
    await Promise.allSettled(promises);
  }
}
