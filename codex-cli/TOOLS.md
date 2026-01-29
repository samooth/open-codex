# OpenCodex Tooling Architecture

This document explains in detail how OpenCodex defines, registers, and executes tools, and how various files in the codebase control these behaviors.

## Core Tooling Files

### 1. `src/utils/agent/agent-loop.ts`
This is the "brain" of the agent. It controls:
- **Registration**: The `run()` method contains the `tools` array passed to the OpenAI API. This defines the JSON schema for every tool the model is aware of.
- **Routing & Parallelism**: The `handleFunctionCall()` method initiates all model-requested tool calls in **parallel** using `Promise.all()`, significantly reducing latency for multi-file operations.
- **Normalization**: This file handles tool aliasing (e.g., mapping `repo_browser.read_file` to the internal `read_file` handler) and strips model-specific suffixes like `<|channel|>`.
- **High-Level Handlers**: Implements specialized tools directly using high-performance asynchronous I/O:
    - `read_file`, `write_file`, `delete_file`: Basic FS operations.
    - `list_directory`: Non-recursive directory listing.
    - `list_files_recursive`: Parallel tree-view project exploration.
    - `read_file_lines`: Reading specific line ranges to save context.
    - `search_codebase`: Structured search using ripgrep (`rg --json`).
    - `persistent_memory`: Fact storage in `.codex/memory.md`.

### 2. `src/utils/agent/handle-exec-command.ts`
Controls the execution of shell commands:
- **Authorization**: Manages the session-level "Always Allow" list. It exports `authorizeCommand()` which is used by the `--allow` CLI flag.
- **Sandbox Decisions**: Determines if a command should run in a restricted environment based on the current policy.
- **Dry Run**: If `dryRun` is enabled in config, it intercepts commands and returns a preview message instead of executing.
- **Key Derivation**: The `deriveCommandKey()` function extracts the base command (e.g., `pytest` from `bash -lc "pytest ..."`) to ensure that authorizing a command works across different shell invocations.

### 3. `src/approvals.ts`
The safety engine of the CLI:
- **Policies**: Defines the three main levels of autonomy: `suggest` (prompt for everything), `auto-edit` (surgical edits allowed), and `full-auto` (sandbox everything).
- **Safety Assessment**: `canAutoApprove()` determines if a specific command string is "known safe" (like `ls` or `pwd`) or if it requires user intervention.
- **Patch Validation**: Contains logic to check if an `apply_patch` operation is constrained to writable paths.

### 4. `src/utils/parsers.ts`
Controls how the agent interprets model output:
- **JSON Extraction**: Contains the logic to find tool calls inside Markdown code blocks or raw text if the model fails to use the native API.
- **Schema Validation**: Uses `zod` to validate tool arguments with `ToolCallArgsSchema`.
- **Heuristic Inference**: If a model provides arguments but forgets the tool name, this file infers the tool based on the properties provided (e.g., if it sees `pattern`, it assumes `search_codebase`).

### 5. `src/utils/agent/apply-patch.ts` & `src/parse-apply-patch.ts`
Control the "surgical edit" capability:
- **Custom Format**: Implements the `*** Begin Patch` / `*** Update File` format.
- **Leniency**: Controls how strictly the agent requires `+` prefixes or hunk headers. It is lenient with missing files during "Update File" (treating them as empty) to support common model behaviors.

---

## How to Add a New Tool

To introduce a new capability to OpenCodex, follow these steps:

1.  **Define the Schema**: Add the tool definition to the `tools` array in `AgentLoop.run()` inside `src/utils/agent/agent-loop.ts`.
2.  **Add a Handler**: Create a private `handleMyNewTool` method in the `AgentLoop` class.
3.  **Register the Route**: Add an `else if (name === "my_new_tool")` block in `handleFunctionCall()`.
4.  **Define Safety (Optional)**: If it's a shell-based tool, update `isSafeCommand()` in `src/approvals.ts` if you want it to be auto-approved in `suggest` mode.
5.  **Update Prompt**: Update the `prefix` constant in `agent-loop.ts` to explain to the model when and why it should use this new tool.

## Tooling Aliases & Compatibility

OpenCodex includes a normalization layer to support models trained on other agentic frameworks (like GPTOSS). The following mappings are controlled in `agent-loop.ts`:

| Model Request | Internal Tool |
| :--- | :--- |
| `repo_browser.exec` | `shell` |
| `repo_browser.read_file` | `read_file` |
| `repo_browser.write_file` | `write_file` |
| `repo_browser.list_files` | `list_files_recursive` |
| `repo_browser.search` | `search_codebase` |
| `repo_browser.print_tree` | `list_files_recursive` |
| `repo_browser.read_file_lines` | `read_file_lines` |
| `repo_browser.list_directory` | `list_directory` |

## User Control via Files

- **`~/.codex/instructions.md`**: Global instructions that can tell the model to prefer certain tools or avoid others.
- **`CODEX.md`**: Project-level documentation that the agent reads to understand specific local scripts or build tools it should use.
- **`~/.codex/config.json`**: Controls the default `approvalMode`, API providers, and session settings.