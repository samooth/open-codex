# OpenCodex Plugin System

OpenCodex supports an extensible plugin system that allows you to add custom tools (functions) to the agent without modifying the core source code.

## How it Works

1.  **Plugins Directory**: OpenCodex scans `~/.open-codex/plugins/` for `.js` files.
2.  **Dynamic Loading**: Every `.js` file that exports a default object matching the `PluginTool` interface is automatically loaded at startup.
3.  **Tool Availability**: Once loaded, these tools are included in the agent's system prompt and can be called by the LLM just like built-in tools (e.g., `read_file`, `shell`).

## Creating a Plugin

A plugin must be a JavaScript file (ESM) that exports a default object with two properties:
- `definition`: The OpenAI-compatible tool definition (JSON schema).
- `handler`: An async function that implements the tool's logic.

### Example Plugin: `hello-world.js`

Save this file to `~/.open-codex/plugins/hello-world.js`:

```javascript
/**
 * @type {import('../src/utils/agent/plugin-manager').PluginTool}
 */
export default {
  definition: {
    type: "function",
    function: {
      name: "hello_world",
      description: "Greets the user or a specific name.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the person to greet."
          }
        },
        required: ["name"]
      }
    }
  },
  handler: async (ctx, args) => {
    const { name } = JSON.parse(args);
    return {
      outputText: `Hello, ${name}! This message comes from a custom OpenCodex plugin.`,
      metadata: { exit_code: 0 }
    };
  }
};
```

## The `PluginTool` Interface

### `definition`
A standard OpenAI `ChatCompletionTool` object. The `name` must be unique and not conflict with built-in tools.

### `handler(ctx, args)`
- `ctx`: The `AgentContext` object, providing access to:
  - `config`: User configuration.
  - `model`: The current model name.
  - `onItem`: Function to send additional messages to the UI.
  - `pluginManager`: Access to other plugins.
- `args`: A JSON string containing the arguments passed by the LLM.

**Return Value**:
An object containing:
- `outputText`: The string result to be sent back to the LLM.
- `metadata`: An object containing at least `{ exit_code: number }`.
- `additionalItems` (optional): An array of `ChatCompletionMessageParam` to be added to the conversation history (e.g., to show a UI message).

## Debugging Plugins

Plugin loading and execution logs are sent to the standard OpenCodex log file. You can monitor it using:

```bash
tail -f ~/.gemini/tmp/open-codex/codex-cli-latest.log
```

(Note: The log path might vary based on your environment settings; check your `DEBUG=1` output for the exact location).
