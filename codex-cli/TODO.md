5. Enhanced Sandbox for Linux
  Improve the Linux sandboxing experience beyond the current container-based approach, possibly using Landlock or namespaces directly if available.

6. Plugin System
  Architecture for extending functionality with custom tools and providers without modifying the core agent loop.

---
**Completed Improvements:**
* **Parallel Tool Execution:** Implemented in `handleFunctionCall` using `Promise.all` for faster multi-gather turns.
* **Parallel File Indexing:** Asynchronous recursive file indexing in `getFileContents` and `handleListFilesRecursive`.
* **Advanced Format Support:** Supported Markdown blocks and raw JSON fallback.
* **Schema Validation:** Strictly enforced tool arguments using Zod.
* **Syntax Highlighting:** Integrated `cli-highlight` for beautiful terminal code rendering.
* **Interactive Config:** Added `/config` command to toggle session settings (Dry Run, Debug) without restart.
* **Enhanced Memory Management:** Added categories to \`persistent_memory\` and a \`summarize_memory\` tool to manage context bloat.
* **Loop Protection Strategy:** Implemented automatic detection of repetitive failing tool calls and updated system prompt to discourage retries.
* **Always-Allow for Patches:** Added `--allow-always-patch` flag to permit session-level auto-approval of file modifications.
* **Live Instruction Editing:** Implemented `/prompt` command to adjust system instructions during a session.
* **Dry-Run Awareness:** Injected explicit session status into the system prompt when `--dry-run` is active.
* **Context-Aware Memory Search:** Implemented semantic search for project memory snippets.
* **Enhanced Tool Visibility & Boxes:** Improved UI with color-coded boxed tool interactions and integrated call/response headers.
* **Persistent Status Bar:** Added real-time visibility of model, provider, mode, and context usage.
* **Interactive History Search:** Integrated search/filtering into `/history` and `/history restore` overlays.
* **Tool Output Highlighting:** Added language-aware syntax highlighting for all tool outputs.
* **Robust Parameter Heuristics:** Automatically handles parameter confusion in `search_codebase` and added aliases for `read_file_lines`.
* **Error Logging:** Implemented `opencodex.error.log` for detailed tool failure tracking.
* **Custom Response Input for Choices:** Added ability to provide custom text input for interactive agent prompts.
* **Native Google SDK Integration:** Migrated to `@google/genai` for better Gemini performance and reliability.
* **Multi-Provider Configuration:** Supported per-provider API keys and base URLs in `config.json`.
* **UI Reorganization:** Consolidated fragmented status info into a unified footer and simplified the input area.