<h1 align="center">Open Codex CLI</h1>
<p align="center">Lightweight coding agent that runs in your terminal</p>

<p align="center"><code>npm i -g @samooth/open-codex</code></p>

> **Important Note**: This is a fork of the [original OpenAI Codex CLI](https://github.com/openai/codex) with expanded model support and changed installation instructions. The main differences in this fork are:
> 
> - Support for multiple AI providers (OpenAI, Gemini, OpenRouter, Ollama, xAI, DeepSeek, Hugging Face)
> - Uses the [Chat Completion API instead of the Responses API](https://platform.openai.com/docs/guides/responses-vs-chat-completions) which allows us to support any openai compatible provider and model.
> - All other functionality remains similar to the original project
> - You can install this fork globally with `npm i -g @samooth/open-codex`

---

<details>
<summary><strong>Table&nbsp;of&nbsp;Contents</strong></summary>

- [Experimental Technology Disclaimer](#experimental-technology-disclaimer)
- [Quickstart](#quickstart)
- [Why Codex?](#whycodex)
- [Security Model & Permissions](#securitymodelpermissions)
  - [Platform sandboxing details](#platform-sandboxing-details)
- [System Requirements](#systemrequirements)
- [CLI Reference](#clireference)
- [Memory & Project Docs](#memoryprojectdocs)
- [Non‑interactive / CI mode](#noninteractivecimode)
- [Editor Integration](#editor-integration)
- [Recipes](#recipes)
- [Installation](#installation)
- [Configuration](#configuration)
- [FAQ](#faq)
- [Contributing](#contributing)
  - [Development workflow](#development-workflow)
  - [Writing high‑impact code changes](#writing-highimpact-code-changes)
  - [Opening a pull request](#opening-a-pull-request)
  - [Review process](#review-process)
  - [Community values](#community-values)
  - [Getting help](#getting-help)
  - [Releasing `codex`](#releasing-codex)
- [Security & Responsible AI](#securityresponsibleai)
- [License](#license)
- [Zero Data Retention (ZDR) Organization Limitation](#zero-data-retention-zdr-organization-limitation)

</details>

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
- **Multiple AI providers** — use OpenAI, Gemini, OpenRouter, Ollama, xAI, DeepSeek, or Hugging Face!
- **High Performance** — parallel tool execution and asynchronous file indexing for speed ✨
- **Syntax Highlighting** — full terminal color support for code diffs and file contents 🎨
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

## Security Model & Permissions

Codex lets you decide _how much autonomy_ the agent receives and auto-approval policy via the
`--approval-mode` flag (or the interactive onboarding prompt):

| Mode                      | What the agent may do without asking            | Still requires approval                                         |
| ------------------------- | ----------------------------------------------- | -------------------------------------------------------------- |
| **Suggest** <br>(default) | • Read any file in the repo                     | • **All** file writes/patches <br>• **All** shell/Bash commands |
| **Auto Edit**             | • Read **and** apply‑patch writes to files      | • **All** shell/Bash commands                                  |
| **Full Auto**             | • Read/write files <br>• Execute shell commands | –                                                              |

In **Full Auto** every command is run **network‑disabled** and confined to the
current working directory (plus temporary files) for defense‑in‑depth. Codex
will also show a warning/confirmation if you start in **auto‑edit** or
**full‑auto** while the directory is _not_ tracked by Git, so you always have a
safety net.

### Dry Run Mode

If you're unsure about what the agent might do, you can use the `--dry-run` flag. In this mode, Codex will simulate all operations (file writes, shell commands, etc.) and show you exactly what it *would* have done without actually touching your filesystem or executing any code.

```shell
open-codex --dry-run "Refactor all components to TypeScript"
```

### Platform sandboxing details

The hardening mechanism Codex uses depends on your OS:

- **macOS 12+** – commands are wrapped with **Apple Seatbelt** (`sandbox-exec`).

  - Everything is placed in a read‑only jail except for a small set of
    writable roots (`$PWD`, `$TMPDIR`, `~/.codex`, etc.).
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
| --------------------------- | --------------------------------------------------------------- |
| Operating systems           | macOS 12+, Ubuntu 20.04+/Debian 10+, or Windows 11 **via WSL2** |
| Node.js                     | **22 or newer** (LTS recommended)                               |
| Git (optional, recommended) | 2.23+ for built‑in PR helpers                                   |
| Lynx (optional)             | Required for web searching and Snyk auditing                    |
| RAM                         | 4‑GB minimum (8‑GB recommended)                                 |

> Never run `sudo npm install -g`; fix npm permissions instead.

---

## CLI Reference

| Command                                   | Purpose                             | Example                              |
| ----------------------------------------- | ----------------------------------- | ------------------------------------ |
| `open-codex`                              | Interactive REPL                    | `codex`                              |
| `open-codex "…"`                          | Initial prompt for interactive REPL | `codex "fix lint errors"`            |
| `open-codex "…"`                          | Auto-enabled quiet mode if non-TTY  | `codex "explain utils.ts"`           |
| `open-codex completion <bash\|zsh\|fish>` | Print shell completion script       | `codex completion bash`              |

Inside the chat, use slash commands like `/help`, `/model`, `/approval`, `/config`, `/history`, and `/clear`.

Key keyboard shortcuts:
- `Ctrl+E`: Open the current prompt in your system's `$EDITOR` (e.g., Vim, Nano) for easier multi-line editing.
- `Ctrl+J`: Insert a newline in the chat input.
- `@`: Trigger file path autocomplete.

Key flags:
- `--provider / -p`: AI provider to use.
- `--model / -m`: Model to use for completions.
- `--approval-mode / -a`: Override the approval policy.
- `--dry-run`: Preview changes without applying them.
- `--quiet / -q`: Non-interactive mode.

---

## Documentation Index

For more detailed information, please refer to the following documents:

- **[Installation Guide](#installation)**: How to install and build from source.
- **[Configuration Guide](#configuration)**: Customizing models, providers, and settings.
- **[Editor Integration](#editor-integration)**: Using OpenCodex with Sublime Text and other editors.
- **[Non-interactive / CI Mode](CI.md)**: Running OpenCodex in automated pipelines.
- **[Recipes](RECIPES.md)**: A collection of common tasks and prompts.
- **[Project Memory & Docs](#memoryprojectdocs)**: Managing persistent project context.
- **[Contributing](CONTRIBUTING.md)**: Workflow and guidelines for developers.
- **[Internal Tools](TOOLS.md)**: Details on the built-in tool architecture.

---

## Memory & Project Docs

Codex merges Markdown instructions in this order:

1. `~/.codex/instructions.md` – personal global guidance
2. `codex.md` at repo root – shared project notes
3. `codex.md` in cwd – sub‑package specifics
4. `.codex/memory.md` – persistent project-specific facts learned by the agent.

Disable with `--no-project-doc` or `CODEX_DISABLE_PROJECT_DOC=1`.

## Tracing / Verbose Logging

Setting the environment variable `DEBUG=true` prints full API request and response details:

```shell
DEBUG=true open-codex
```

---

## Editor Integration

## Installation

<details open>
<summary><strong>From npm (Recommended)</strong></summary>

```bash
npm install -g @samooth/open-codex
# or
yarn global add @samooth/open-codex
```

</details>

<details>
<summary><strong>Build from source</strong></summary>

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

</details>

---

## Configuration

Codex looks for config files in **`~/.codex/`** (either YAML or JSON format). The configuration is validated using Zod to ensure correctness.

```json
// ~/.codex/config.json
{
  "model": "o4-mini", // Default model
  "provider": "openai", // Default provider
  "approvalMode": "suggest", // or auto-edit, full-auto
  "fullAutoErrorMode": "ask-user", // or ignore-and-continue
  "memory": {
    "enabled": true
  }
}
```

You can also define custom instructions:

```md
# ~/.codex/instructions.md

- Always respond with emojis
- Only use git commands if I explicitly mention you should
```

### Alternative AI Providers

This fork of Codex supports multiple AI providers:

- openai (default)
- gemini
- openrouter
- ollama
- xai
- deepseek
- hf (Hugging Face)

To use a different provider, set the `provider` key in your config file:

```json
{
  "provider": "gemini"
}
```

OR use the `--provider` flag. eg. `codex --provider gemini`

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
- **How it works**: Codex generates vector embeddings for your files and stores them locally in `.codex/`.
- **Default Embedding Models**:
  - **OpenAI**: `text-embedding-3-small`
  - **Gemini**: `text-embedding-004`
  - **Ollama**: `nomic-embed-text`

You can override the embedding model in your `config.json`:

```json
{
  "embeddingModel": "text-embedding-004"
}
```

### Slash Commands

Inside the interactive chat, you can use several slash commands to manage your session:

| Command     | Description                                                                 |
| ----------- | --------------------------------------------------------------------------- |
| `/help`     | Show the help overlay with all available commands and shortcuts.             |
| `/model`    | Open the model picker to switch the current AI model.                       |
| `/index`    | Index the current codebase for semantic search.                             |
| `/pin <path>`| Pin a file to the context window (it will always be included in the prompt).|
| `/unpin <path>`| Unpin a file from the context window.                                     |
| `/approval` | Change the current approval mode (Suggest, Auto Edit, Full Auto).            |
| `/config`   | Toggle settings like Dry Run and Debug mode.                                |
| `/history`  | View and select from your prompt history.                                   |
| `/memory`   | View and manage the agent's persistent project memory.                       |
| `/theme`    | Change the UI theme (Default, Nord, One Dark, Synthwave, Gruvbox, Cyberpunk).|
| `/clear`    | Clear the chat history (start a fresh session).                             |

#### File Pinning

File pinning allows you to ensure that specific files are always included in the agent's context window, regardless of the conversation length. This is useful for keeping core documentation, API definitions, or complex logic always "top of mind" for the agent.

- **To pin a file**: `/pin src/main.ts`
- **To unpin a file**: `/unpin src/main.ts`

Pinned files are persisted in your `~/.codex/config.json` and will be loaded in every session.

#### Dynamic Model Discovery

For many providers, you can use the `/models` command within the interactive chat to see a list of available models and switch between them. For the **Hugging Face** provider, this dynamically fetches the latest `tool-use` compatible models directly from the Hugging Face Hub.

Here's a list of all the providers and their default models:

| Provider   | Environment Variable Required | Default Agentic Model        | Default Full Context Model |
| ---------- | ----------------------------- | ---------------------------- | -------------------------- |
| openai     | OPENAI_API_KEY                | o4-mini                      | o3                         |
| gemini     | GEMINI_API_KEY                | gemini-2.5-flash             | gemini-2.5-flash           |
| openrouter | OPENROUTER_API_KEY            | openai/o4-mini               | openai/o3                  |
| ollama     | Not required                  | User must specify            | User must specify          |
| xai        | XAI_API_KEY                   | grok-3-mini-beta             | grok-3-beta                |
| deepseek   | DS_API_KEY                    | deepseek-chat                | deepseek-reasoner          |
| hf         | HF_API_KEY                    | moonshotai/Kimi-K2.5         | moonshotai/Kimi-K2.5       |

#### When using an alternative provider, make sure you have the correct environment variables set.

```bash
export GEMINI_API_KEY="your-gemini-api-key-here"
```

---

## FAQ

<details>
<summary>What's the difference between this and the original OpenAI Codex CLI?</summary>

This is a fork of the original OpenAI Codex CLI project with expanded support for multiple AI providers beyond just OpenAI. The installation package is also different (`open-codex` instead of `@openai/codex`), but the core functionality remains similar.

</details>

<details>
<summary>How do I stop Codex from touching my repo?</summary>

Codex always runs in a **sandbox first**. If a proposed command or file change looks suspicious you can simply answer **n** when prompted and nothing happens to your working tree. For extra safety, use the `--dry-run` flag.

</details>

<details>
<summary>Does it work on Windows?</summary>

Not directly. It requires [Windows Subsystem for Linux (WSL2)](https://learn.microsoft.com/en-us/windows/wsl/install) – Codex has been tested on macOS and Linux with Node ≥ 22.

</details>

<details>
<summary>Which models are supported?</summary>

The default is `o4-mini`, but pass `--model gpt-4o` or set `model: gpt-4o` in your config file to override.

You can also use models from other providers like Gemini, DeepSeek, and Hugging Face. See the [Configuration](#configuration) section for more details.

</details>

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