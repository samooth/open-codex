# Model Context Protocol (MCP) Integration

Open Codex supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/), an open standard that enables AI models to interact with external tools, resources, and prompts provided by MCP servers.

## Features

- **Parallel Connections**: Connects to multiple MCP servers concurrently for faster startup.
- **Dynamic Tool Loading**: Automatically discovers and exposes tools from connected MCP servers.
- **Resource Support**:
    - `[serverName]_list_resources`: List available resources.
    - `[serverName]_read_resource`: Read the content of a specific resource.
- **Prompt Support**:
    - `[serverName]_list_prompts`: List available prompts.
    - `[serverName]_get_prompt`: Retrieve a specific prompt with arguments.
- **Custom Environment Variables**: Pass specific environment variables to each MCP server.
- **Automatic Tool Naming**: Tools are prefixed with the server name (e.g., `mysql_query_database`) to prevent naming collisions.

## Configuration

MCP servers are configured in your `~/.open-codex/config.json` file under the `mcpServers` key.

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sqlite", "--dbpath", "/path/to/database.db"]
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-postgres", "postgresql://localhost/mydb"],
      "env": {
        "PGPASSWORD": "your-password"
      }
    }
  }
}
```

### Configuration Options

- `command` (string, required): The command to start the MCP server.
- `args` (string[], optional): Arguments to pass to the command.
- `env` (object, optional): Environment variables to set for the MCP server process.

## Usage

Once configured, Open Codex will automatically connect to the servers during startup. The tools, resources, and prompts from these servers will be available to the agent.

### Naming Convention

To avoid conflicts between different servers, all items are prefixed with the server name:
- Tools: `[serverName]_[toolName]`
- Resource Listing: `[serverName]_list_resources`
- Resource Reading: `[serverName]_read_resource`
- Prompt Listing: `[serverName]_list_prompts`
- Prompt Getting: `[serverName]_get_prompt`

## Popular Servers

### Chrome DevTools

Control a local Chrome instance to automate browsing, testing, and debugging.

```json
{
  "mcpServers": {
    "chrome": {
      "command": "npx",
      "args": [
        "-y",
        "chrome-devtools-mcp@latest",
        "--isolated", 
        "--executablePath", "/usr/bin/google-chrome"
      ]
    }
  }
}
```

**Recommended Arguments:**
- `--isolated`: Creates a temporary user profile for each session. Prevents conflicts with your running browser and avoids "Browser already running" errors.
- `--executablePath <path>`: Point to a specific browser binary (e.g., `/usr/bin/chromium`) if the default detection fails.
- `--headless=false`: Run with a visible window (default is often headless).

## Troubleshooting

- **Logs**: Connection status and errors are logged to the internal agent log. You can see these by running with `DEBUG=1`.
- **"Ghosting" UI / Terminal Artifacts**: Some MCP servers (like Chrome) print verbose info/disclaimers to `stderr`. Open Codex automatically redirects this output to the internal log file (`~/.local/open-codex/codex-cli-latest.log`) to keep the terminal UI clean.
- **Tool Arguments**: If tools complain about missing parameters (e.g., "Required: url"), ensure you are running the latest version of Open Codex. We recently fixed an issue where unknown parameters were stripped before sending.
- **Tool Discovery**: If a tool is not appearing, check if the MCP server is correctly started and responding to the `listTools` capability.
- **Permissions**: Ensure the command and arguments have the necessary permissions to execute on your system.
