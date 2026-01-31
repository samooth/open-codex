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