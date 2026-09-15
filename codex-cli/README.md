# Open Codex CLI

Lightweight coding agent that runs in your terminal

`npm i -g @samooth/open-codex`

> **Important Note**: This is a fork of the [original OpenAI Codex CLI](https://github.com/openai/codex) with expanded model support and changed installation instructions. The main differences in this fork are:
>
> - Support for multiple AI providers (OpenAI, Anthropic, Gemini, OpenRouter, Ollama, xAI, DeepSeek, Hugging Face)
> - Uses the [Chat Completion API instead of the Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions) which allows us to support any openai compatible provider and model.
> - All other functionality remains similar to the original project
> - You can install this fork globally with `npm i -g @samooth/open-codex`

---

## Table of Contents

- [Experimental Technology Disclaimer](#experimental-technology-disclaimer)
- [Quickstart](#quickstart)
- [Why Codex?](#why-codex)
- [Model Context Protocol (MCP)](#mcp-support)
- [Security Model & Permissions](#security-model--permissions)
- [Platform sandboxing details](#platform-sandboxing-details)
- [System Requirements](#system-requirements)
- [CLI Reference](#cli-reference)
- [Memory & Project Docs](#memory--project-docs)
- [Non-interactive / CI mode](docs/CI.md)
- [Editor Integration](#documentation-index)
- [Recipes](docs/RECIPES.md)

- [Installation](#installation)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Contributing](docs/PROJECT_CONTRIBUTING.md)
- [Security & Responsible AI](#security--responsible-ai)
- [License](#license)
- [Zero Data Retention (ZDR) Organization Limitation](#zero-data-retention-zdr-organization-limitation)

---

## Experimental Technology Disclaimer

Codex CLI is an experimental project under active development. It is not yet stable, may contain bugs, incomplete features, or undergo breaking changes. We're building it in the open with the community and welcome:

- Bug reports
- Feature requests
- Pull requests
- Good vibes

Help us improve by filing issues or submitting PRs (see the section below for how to contribute)!

## Quickstart

Install globally:

```shell
npm install -g @samooth/open-codex
```

Next, set your API key as an environment variable (shown here with OpenAI, but other providers are supported):

```shell
export OPENAI_API_KEY="your-api-key-here"
# or
export ANTHROPIC_API_KEY="your-api-key-here"
# or (optional for local/proxied Ollama)
export OLLAMA_API_KEY="your-api-key-here"
```

> **Note:** This command sets the key only for your current terminal session. To make it permanent, add the `export` line to your shell's configuration file (e.g., `~/.zshrc`).
>
> **Tip:** You can also place your API key into a `.env` file at the root of your project:
>
> ```env
> OPENAI_API_KEY=your-api-key-here
> ```
>
> The CLI will automatically load variables from `.env` (via `dotenv/config`).

Run interactively:

```shell
open-codex
```

Or, run with a prompt as input (and optionally in `Full Auto` mode):

```shell
open-codex "explain this codebase to me"
```

```shell
open-codex --approval-mode full-auto "create the fanciest todo-list app"
```

That's it – Codex will scaffold a file, run it inside a sandbox, install any
missing dependencies, and show you the live result. Approve the changes and
they'll be committed to your working directory.

---

## Why Codex?

Codex CLI is built for developers who already **live in the terminal** and want
ChatGPT‑level reasoning **plus** the power to actually run code, manipulate
files, and iterate – all under version control. In short, it's _chat‑driven
development_ that understands and executes your repo.

- **Zero setup** — bring your API key and it just works!
- **Multiple AI providers** — use OpenAI, Anthropic, Gemini, OpenRouter, Ollama, xAI, DeepSeek, Moonshot or Hugging Face!
- **High Performance** — parallel tool execution and asynchronous file indexing for speed ✨
- **MCP Support** — native integration with the Model Context Protocol for extensible tools, resources, and prompts 🔌
- **Surgical Editing** — robust Search & Replace tool for precise, context-aware file modifications 📝
- **Code Intelligence** — specialized tools to extract symbols and search definitions semantically 🔍
- **Automated Verification** — built-in diagnostics to detect project types and run health checks (lint, type-check, tests) 🩺
- **Interactive Roadmap** — persistent task checklist in the UI to track multi-step goal progress 📋
- **Syntax Highlighting** — full terminal color support for code diffs and file contents 🎨
- **Context Management** — automated sliding window history truncation and **collapsible history blocks** to keep the UI clean 🧠
- **Beautiful UI** — bot icons, model labels, **responsive layout breakpoints**, and sleek left-accent bars for clarity ✨
- **Prompt Caching** — native support for Anthropic `cache_control` to significantly reduce costs and latency in long-running sessions 🚀
- **Command Re-run** — quickly access and re-execute previous shell commands with a specialized history overlay 🐚
- **Live Indexing** — non-blocking background status indicator for semantic codebase indexing 📂
- **UI & Architecture Stability** — 100+ typecheck errors resolved, improved layout constraints, and robust ESM/CJS compatibility 🛠️
- **Security & Dependency Auditing** — built-in tools for searching npm and Snyk vulnerability databases 🛡️
- **Full auto-approval, while safe + secure** by running network-disabled and directory-sandboxed
- **Multimodal** — pass in screenshots or diagrams to implement features ✨
- **Planning Visibility** — real-time display of agent `<plan>` blocks in the UI thinking state 📋
- **UI Stability** — intelligent truncation of large patches/commands to prevent flickering and overflow 🛠️
- **Dry Run mode** — preview all changes without actually modifying files or running commands!
- **Interactive Config** — toggle settings like dry-run and debug mode in-session with `/config` ⚙️
- **Loop Protection** — automatic detection and prevention of repetitive failing tool calls 🔄

And it's **fully open-source** so you can see and contribute to how it develops!

---

## Model Context Protocol (MCP)

Open Codex supports the **Model Context Protocol (MCP)**, allowing you to extend the agent's capabilities with external tools, resources, and prompts. Connect to any MCP-compatible server (like SQLite, PostgreSQL, or custom tools) by adding them to your configuration.

For more details, see the **[MCP Integration Guide](docs/MCP.md)**.

---

## Security Model & Permissions

Codex lets you decide _how much autonomy_ the agent receives and auto-approval policy via the
`--approval-mode` flag (or the interactive onboarding prompt):

| Mode                  | What the agent may do without asking            | Still requires approval                                         |
| :-------------------- | :---------------------------------------------- | :-------------------------------------------------------------- |
| **Suggest** (default) | • Read any file in the repo                     | • **All** file writes/patches <br>• **All** shell/Bash commands |
| **Auto Edit**         | • Read **and** apply‑patch writes to files      | • **All** shell/Bash commands                                   |
| **Full Auto**         | • Read/write files <br>• Execute shell commands | –                                                               |

In **Full Auto** every command is run **network‑disabled** and confined to the
current working directory (plus temporary files) for defense‑in‑depth. Codex
will also show a warning/confirmation if you start in **auto‑edit** or
**full‑auto** while the directory is _not_ tracked by Git, so you always have a
safety net.

### Dry Run Mode

If you're unsure about what the agent might do, you can use the `--dry-run` flag. In this mode, Codex will simulate all operations (file writes, shell commands, etc.) and show you exactly what it _would_ have done without actually touching your filesystem or executing any code.

```shell
open-codex --dry-run "Refactor all components to TypeScript"
```

### Reverting Changes (/undo)

If the agent makes a mistake or you want to roll back the last set of file changes and conversation turns, you can use the `/undo` command at any time. This will:

1. Restore any files modified or deleted in the last turn to their previous state.
2. Remove the last user prompt and assistant response from the session history.
3. Clean up any temporary files created during that turn.

Simply type `/undo` in the chat or use the Command Palette (`Ctrl+P`).

### Platform sandboxing details

The hardening mechanism Codex uses depends on your OS:

- **macOS 12+** – commands are wrapped with **Apple Seatbelt** (`sandbox-exec`).

  - Everything is placed in a read‑only jail except for a small set of
    writable roots (`$PWD`, `$TMPDIR`, `~/.open-codex`, etc.).
  - Outbound network is _fully blocked_ by default – even if a child process
    tries to `curl` somewhere it will fail.

- **Linux** – there is no sandboxing by default.
  We recommend using Docker for sandboxing, where Codex launches itself inside a **minimal
  container image** and mounts your repo _read/write_ at the same path. A
  custom `iptables`/`ipset` firewall script denies all egress except the
  OpenAI API. This gives you deterministic, reproducible runs without needing
  root on the host. You can use the [`run_in_container.sh`](./codex-cli/scripts/run_in_container.sh) script to set up the sandbox.

---

## System Requirements

| Requirement                 | Details                                                         |
| :-------------------------- | :-------------------------------------------------------------- |
| Operating systems           | macOS 12+, Ubuntu 20.04+/Debian 10+, or Windows 11 **via WSL2** |
| Node.js                     | **22 or newer** (LTS recommended)                               |
| Git (optional, recommended) | 2.23+ for built‑in PR helpers                                   |
| Lynx (optional)             | Required for web searching and Snyk auditing                    |
| RAM                         | 4‑GB minimum (8‑GB recommended)                                 |

> Never run `sudo npm install -g`; fix npm permissions instead.

---

## CLI Reference

| Command                                   | Purpose                               | Example                        |
| :---------------------------------------- | :------------------------------------ | :----------------------------- |
| `open-codex`                              | Interactive REPL                      | `codex`                        |
| `open-codex "…"`                          | Initial prompt for interactive REPL   | `codex "fix lint errors"`      |
| `open-codex "…"`                          | Auto-enabled quiet mode if non-TTY    | `codex "explain utils.ts"`     |
| `open-codex -r <recipe> "…"`              | Run with a predefined prompt template | `codex -r test "src/utils.ts"` |
| `open-codex completion <bash\|zsh\|fish>` | Print shell completion script         | `codex completion bash`        |

Inside the chat, use slash commands like `/help`, `/model`, `/approval`, `/config`, `/history`, and `/clear`.

### Key keyboard shortcuts:

- `Ctrl+E`: Open the current prompt in your system's `$EDITOR` (e.g., Vim, Nano) for easier multi-line editing.
- `Ctrl+P`: Open the Command Palette to search all actions and recipes.
- `Ctrl+R`: Open the Command History overlay to re-run or edit previous shell commands.
- `Ctrl+Y`: Yank (copy) the last generated code block to the system clipboard.
- `Ctrl+B`: Toggle detailed token usage breakdown in the status bar.
- `Ctrl+J`: Insert a newline in the chat input.
- `C`: Toggle collapse/expand on a selected message turn or tool output.
- `Up Arrow`: Pull merged instructions from the queue for editing (if idle).
- `@`: Trigger file path autocomplete.

### Key flags:

- `--provider / -p`: AI provider to use.
- `--model / -m`: Model to use for completions.
- `--recipe / -r`: Apply a predefined prompt template (recipe).
- `--approval-mode / -a`: Override the approval policy.
- `--dry-run`: Preview changes without applying them.
- `--quiet / -q`: Non-interactive mode.
- `--think`: Enable deep thinking subroutine prefix.

---

## Documentation Index

For more detailed information, please refer to the following documents:

- **[Installation Guide](#installation)**: How to install and build from source.
- **[Configuration Guide](#configuration)**: Customizing models, providers, and settings.
- **Editor Integration**: Using OpenCodex with [Sublime Text](docs/SUBLIME.md), [VS Code](docs/VSCODE.md), and other editors.
- **[Non-interactive / CI Mode](docs/CI.md)**: Running OpenCodex in automated pipelines.
- **[Recipes](docs/RECIPES.md)**: A collection of common tasks and prompts.
- **[Project Memory & Docs](#memoryprojectdocs)**: Managing persistent project context.
- **[MCP Integration Guide](docs/MCP.md)**: Using the Model Context Protocol to extend Open Codex.
- **[SearXNG Integration Guide](docs/SEARXNG_INTEGRATION.md)**: Setting up a custom search provider.
- **[Contributing](docs/PROJECT_CONTRIBUTING.md)**: Workflow and guidelines for developers.
- **[Internal Tools](docs/TOOLS.md)**: Details on the built-in tool architecture.
- **[Roadmap](docs/ROADMAP.md)**: Planned features and project milestones.

---

## Memory & Project Docs

Codex merges Markdown instructions in this order:

1. `~/.open-codex/instructions.md` – personal global guidance
2. `open-codex.md` at repo root – shared project notes
3. `open-codex.md` in cwd – sub‑package specifics
4. `.open-codex/memory.md` – persistent project-specific facts learned by the agent.

Disable with `--no-project-doc` or `CODEX_DISABLE_PROJECT_DOC=1`.

## Tracing / Verbose Logging

Setting the environment variable `DEBUG=true` prints full API request and response details:

```shell
DEBUG=true open-codex
```

---

## Installation

### From npm (Recommended)

```bash
npm install -g @samooth/open-codex
# or
yarn global add @samooth/open-codex
```

### Build from source

```bash
# Clone the repository and navigate to the CLI package
git clone https://github.com/ymichael/open-codex.git
cd open-codex/codex-cli

# Install dependencies and build
npm install
npm run build

# Get the usage and the options
node ./dist/cli.js --help

# Run the locally‑built CLI directly
node ./dist/cli.js

# Or link the command globally for convenience
npm link
```

---

## Configuration

Codex looks for config files in **`~/.open-codex/`** (either YAML or JSON format). The configuration is validated using Zod to ensure correctness.

```json
// ~/.open-codex/config.json
{
  "model": "gpt-5.2", // Default model
  "provider": "openai", // Default provider
  "approvalMode": "suggest", // or auto-edit, full-auto
  "fullAutoErrorMode": "ask-user", // or ignore-and-continue
  "memory": {
    "enabled": true
  },
  "searxngUrl": "https://your-searxng-instance.com" // Optional: URL for your SearXNG instance
}
```

You can also define custom instructions:

```md
# ~/.open-codex/instructions.md

- Always respond with emojis
- Only use git commands if I explicitly mention you should
```

### Alternative AI Providers

This fork of Codex supports multiple AI providers:

- openai (default)
- anthropic
- gemini
- openrouter
- ollama
- xai
- deepseek
- moonshot
- hf (Hugging Face)

To use a different provider, set the `provider` key in your config file:

```json
{
  "provider": "gemini"
}
```

OR use the `--provider` flag. eg. `codex --provider gemini`

#### Anthropic Configuration

To use Anthropic models, ensure you have your API key set:

```bash
export ANTHROPIC_API_KEY="your-anthropic-api-key-here"
```

Then run Codex specifying the provider:

```bash
open-codex --provider anthropic
```

The default agentic model is `claude-opus-4-6`. You can switch to other models like `claude-sonnet-4-5-20250929` or `claude-haiku-4-5-20251001` using the `/model` command in-session or the `--model` flag.

#### Ollama Configuration

When using Ollama, ensure your server is running (`ollama serve`) and you have pulled the desired model (`ollama pull llama3`).

- **Base URL**: By default, Codex connects to `http://localhost:11434/v1`. You can override this by setting the `OLLAMA_BASE_URL` environment variable or by adding it to your `config.json`:

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": {
      "baseURL": "http://192.168.1.100:11434/v1"
    }
  }
}
```

- **Model**: Specify your local model using the `--model` flag or in your config:

```bash
open-codex --provider ollama --model mistral "Explain this project"
```

### Semantic Search & Indexing

Codex can index your codebase to provide better context during chat. This allows the agent to "find" relevant code snippets even if they aren't explicitly pinned or open.

- **`/index`**: Run this command inside the chat to start indexing your current directory.
- **How it works**: Codex generates vector embeddings for your files and stores them locally in `.open-codex/`.
- **Default Embedding Models**:
  - **OpenAI**: `text-embedding-3-small`
  - **Gemini**: `text-embedding-005`
  - **Ollama**: `nomic-embed-text`

You can override the embedding model in your `config.json`:

```json
{
  "embeddingModel": "text-embedding-004"
}
```

### Context Window Management

To prevent API errors like "Tokens Per Minute (TPM) limit exceeded" or context overflow, Codex automatically manages your conversation history using a **Sliding Window** strategy:

- **Automatic Truncation**: When the conversation history grows too long, Codex prunes the oldest messages while keeping your recent context and the system prompt intact.
- **Content Pruning**: For very old tool results (like large file reads), Codex automatically truncates the content to save tokens while preserving the conversational logic.
- **Configurable**: You can adjust the maximum number of messages kept in context by setting `"contextSize"` in your `~/.open-codex/config.json`.

### Prompt Caching

To reduce latency and costs, OpenCodex leverages prompt caching where supported:

- **Anthropic**: Uses explicit `cache_control` breakpoints. OpenCodex automatically caches the system instructions, the large tool definitions list, and the most recent stable turn of the conversation history.
- **OpenAI & DeepSeek & Moonshot**: Caching is automatic. These providers automatically cache the prefix of prompts that exceed 1024 tokens.
- **Ollama**: Local KV caching is automatic. Ollama reuses the processed prefix of the conversation history to speed up subsequent turns.
- **Gemini**: Large context is managed via a sliding window; dedicated Context Caching for static datasets is not currently utilized as the default window is usually sufficient.

### Slash Commands

Inside the interactive chat, you can use several slash commands to manage your session:

| Command         | Description                                                                   |
| :-------------- | :---------------------------------------------------------------------------- |
| `/help`         | Show the help overlay with all available commands and shortcuts.              |
| `/model`        | Open the model picker to switch the current AI model.                         |
| `/index`        | Index the current codebase for semantic search.                               |
| `/pin <path>`   | Pin a file to the context window (it will always be included in the prompt).  |
| `/unpin <path>` | Unpin a file from the context window.                                         |
| `/approval`     | Change the current approval mode (Suggest, Auto Edit, Full Auto).             |
| `/config`       | Toggle settings like Dry Run and Debug mode.                                  |
| `/history`      | View and select from your prompt history.                                     |
| `/memory`       | View and manage the agent's persistent project memory.                        |
| `/theme`        | Change the UI theme (Default, Nord, One Dark, Synthwave, Gruvbox, Cyberpunk). |
| `/clear`        | Clear the chat history (start a fresh session).                               |

#### File Pinning

File pinning allows you to ensure that specific files are always included in the agent's context window, regardless of the conversation length. This is useful for keeping core documentation, API definitions, or complex logic always "top of mind" for the agent.

- **To pin a file**: `/pin src/main.ts`
- **To unpin a file**: `/unpin src/main.ts`

Pinned files are persisted in your `~/.open-codex/config.json` and will be loaded in every session.

#### Dynamic Model Discovery

For many providers, you can use the `/models` command within the interactive chat to see a list of available models and switch between them. For the **Hugging Face** provider, this dynamically fetches the latest `tool-use` compatible models directly from the Hugging Face Hub.

Here's a list of all the providers and their default models:

| Provider   | Environment Variable Required | Default Agentic Model   | Default Full Context Model |
| :--------- | :---------------------------- | :---------------------- | :------------------------- |
| openai     | OPENAI_API_KEY                | gpt-5.1-codex           | gpt-5.1-codex              |
| anthropic  | ANTHROPIC_API_KEY             | claude-opus-4-6         | claude-opus-4-6            |
| gemini     | GEMINI_API_KEY                | gemini-2.5-flash        | gemini-2.5-flash           |
| openrouter | OPENROUTER_API_KEY            | openai/gpt-5.2          | openai/gpt-5.2             |
| ollama     | OLLAMA_API_KEY (optional)     | User must specify       | User must specify          |
| xai        | XAI_API_KEY                   | grok-4-1-fast-reasoning | grok-4-1-fast-reasoning    |
| deepseek   | DS_API_KEY                    | deepseek-chat           | deepseek-reasoner          |
| hf         | HF_API_KEY                    | moonshotai/Kimi-K2.5    | moonshotai/Kimi-K2.5       |
| moonshot   | MOONSHOT_API_KEY              | kimi-k2-turbo-preview   | kimi-k2-turbo-preview      |

#### When using an alternative provider, make sure you have the correct environment variables set.

```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
# or
export MOONSHOT_API_KEY="your-moonshot-api-key-here"
# or
export ANTHROPIC_API_KEY="your-anthropic-api-key-here"
# or
export OLLAMA_API_KEY="your-ollama-api-key-here"

```

---

## FAQ

**What's the difference between this and the original OpenAI Codex CLI?**
This is a fork of the original OpenAI Codex CLI project with expanded support for multiple AI providers beyond just OpenAI. The installation package is also different (`open-codex` instead of `@openai/codex`), but the core functionality remains similar.

**How do I stop Codex from touching my repo?**
Codex always runs in a **sandbox first**. If a proposed command or file change looks suspicious you can simply answer **n** when prompted and nothing happens to your working tree. For extra safety, use the `--dry-run` flag.

**Does it work on Windows?**
Not directly. It requires [Windows Subsystem for Linux (WSL2)](https://learn.microsoft.com/en-us/windows/wsl/install) – Codex has been tested on macOS and Linux with Node ≥ 22.

**Which models are supported?**
The default is `gpt-5.1-codex`, but pass `--model gpt-4o` or set `model: gpt-4o` in your config file to override. You can also use models from other providers like Gemini, DeepSeek, and Hugging Face. See the [Configuration](#configuration) section for more details.

---

## Zero Data Retention (ZDR) Organization Limitation

> **Note:** Codex CLI does **not** currently support OpenAI organizations with [Zero Data Retention (ZDR)](https://platform.openai.com/docs/guides/your-data#zero-data-retention) enabled.

If your OpenAI organization has Zero Data Retention enabled, you may encounter errors such as:

```
OpenAI rejected the request. Error details: Status: 400, Code: unsupported_parameter, Type: invalid_request_error, Message: 400 Previous response cannot be used for this organization due to Zero Data Retention.
```

**Why?**

- Codex CLI relies on the Responses API with `store:true` to enable internal reasoning steps.
- As noted in the [docs](https://platform.openai.com/docs/guides/your-data#responses-api), the Responses API requires a 30-day retention period by default, or when the store parameter is set to true.
- ZDR organizations cannot use `store:true`, so requests will fail.

**What can I do?**

- If you are part of a ZDR organization, Codex CLI will not work until support is added.
- We are tracking this limitation and will update the documentation if support becomes available.

---

## Security & Responsible AI

Have you discovered a vulnerability or have concerns about model output? Please **open a GitHub issue** or submit a pull request with a fix. We take security seriously and will respond promptly.

---

## License

This repository is licensed under the [Apache-2.0 License](LICENSE).

Original project: [OpenAI Codex CLI](https://github.com/openai/codex)
