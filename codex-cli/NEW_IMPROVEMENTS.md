# UI Improvement Suggestions for OpenCodex CLI - Status Update


Based on the current state of OpenCodex, here are several high-impact UI/UX improvements that could further enhance the terminal experience:

  1. Advanced Input Experience
   * External Editor Integration: Add a shortcut (e.g., Ctrl+E) to open the current prompt in your system's $EDITOR (vim, nano, vscode). This is essential for long prompts or pasting large code blocks.
   * True Multi-line Support: Enhance the internal input component to handle newlines natively (Shift+Enter) rather than just single-line scrolling.
   * Variable Injection: Allow users to reference environment variables or file contents directly in the prompt using syntax like fix the bug in {{src/main.ts}}.


  2. Context Management
   * File Pinning: A way to "pin" specific files to the context window so they are never rotated out during long conversations.
   * Context Breakdown: A small expandable view in the status bar showing exactly how many tokens are being used by the System Prompt, History, and current "Active Files."
   * Automatic "Ignored Files" Preview: A command to see what .codexignore is currently filtering out, to help debug why the agent might "miss" a file.


  3. Richer Interaction
   * Interactive Diffs: Instead of just "Yes/No" for a whole patch, allow the user to select specific "hunks" (parts of the diff) to apply or discard.
   * Collapsible Tool Outputs: For huge shell outputs (like a long npm install), add a way to collapse the box to just the header/summary to reduce clutter.
   * Command Re-run: An interactive history view where you can highlight a previous shell command and hit R to re-execute it.


  4. Visibility & Feedback
   * Latency & Cost Tracking: Show real-time latency (ms) for the last request and, if possible, an estimated cost (based on tokens) for the session.
   * Audio Notifications: An optional "ping" sound when a long-running task (like indexing or a 30-second "Deep Thinking" step) completes.
   * Confidence Indicators: Show a "confidence score" or a warning if the agent thinks the proposed patch might have side effects.


  5. Customization
   * Dynamic Theming: Support for custom JSON themes where users can map specific ANSI colors to "thoughts," "commands," and "errors."
   * Prompt Templates: A library of "recipes" accessible via /recipes (e.g., "Unit Test Generator," "Documentation Writer," "Security Auditor").


  6. Semantic Search 2.0
   * Live Indexing Indicator: A more subtle, non-blocking progress bar for when the agent is updating the vector database in the background.
   * Search "Heatmap": When using semantic_search, show a snippet of why a file was ranked highly (highlighting the matching concept).


Here is the current state of UI improvements for the OpenCodex CLI:

*   **[DONE] Support for `<think>` tags:** The UI now correctly parses and styles `<think>` blocks output by deep-thinking models, rendering them in a distinct, italicized, and dimmed box.
    *   **[DONE] Scrolling Reasoning:** A scrolling mechanism within the thinking indicator has been implemented, allowing users to navigate through lengthy partial reasoning using the arrow keys.
    *   **[DONE] Active Tool Indicator:** The active tool name (e.g., `shell`, `read_file`) is now displayed within the thinking indicator.
    *   **[DONE] Empty Command Fallback:** If the model emits an empty command block (e.g., `command {}`), the system now defaults to executing `ls -F` to help the model gather context about the current directory.
    *   **[DONE] Tool Arguments Preview:** A concise preview of tool arguments is now shown next to the active tool name.
*   **[DONE] Structured Tool Output Display:** Tool calls and outputs are rendered in rounded boxes. Failed commands are highlighted with a red border and include "Tool Call Details" (name and arguments) for easier debugging.
*   **[DONE] Robust Shell Execution:** Improved handling of complex shell commands, avoiding over-quoting and correctly identifying shell built-ins.
*   **[DONE] Cross-Platform Support:** 
    *   **Windows Support:** Fully implemented Unix-to-Windows command mapping and native process termination using `taskkill`.
    *   **Path Normalization:** Automatic conversion of Windows-style backslashes to forward slashes for consistent `.gitignore` and `.codexignore` behavior.
---
## 2. Improved User Input and Interaction

    * **[DONE] Integrated Tool Display:** Tool calls and responses are now merged into a single visual unit, reducing vertical spacing and providing immediate context for results.

    * **[DONE] Language-Aware Output Highlighting:** All tool outputs (file reads, search results, etc.) now feature automatic syntax highlighting based on content type and file extensions.

    * **[DONE] Persistent Status Bar:** A real-time status bar at the bottom of the screen displays the active model, provider, approval mode, a visual context usage bar, and the current session ID.

*   **[DONE] Interactive History Search:** 

    *   **[DONE] Filtered Restoration:** Added a search bar to `/history restore`, allowing users to quickly find past sessions by summary, date, or model.

    *   **[DONE] Filtered Activity:** Both "Commands run" and "Files touched" views in `/history` now support interactive filtering via the `/` key.

*   **[DONE] Visual Prompt Queue:** 

    *   A small indicator showing the number of queued prompts is displayed in the status line.

    *   Input is always visible and active, even when the agent is busy; new inputs are automatically queued.

* **[DONE] Slash Command Suggestions:** When the user types `/`, a list of available slash commands (e.g., `/model`, `/clear`, `/history`) with descriptions is displayed above the input area. Users can navigate these suggestions using arrow keys or Tab and select them with Return.



* **[DONE] Deep Thinking Flag:** Added `--think` command line parameter to explicitly enable the "Deep Thinking" protocol and identity prefix from the start of a session.



*   **[DONE] Robust Tool Heuristics:**

    *   **[DONE] search_codebase:** Automatically detects and corrects cases where the model confuses `pattern` and `query` arguments.

    *   **[DONE] search_codebase:** Supports "file listing mode" where passing a glob pattern (e.g., `*.ts`) without a query lists all matching files.

    *   **[DONE] read_file_lines:** Added support for common aliases like `start`/`end` and `line_start`/`line_end`.

*   **[DONE] Error Tracking:**

    *   **[DONE] Detailed Error Log:** All failed tool calls are now automatically logged to `opencodex.error.log` with full metadata (timestamp, provider, model, arguments, and error output) for easier debugging.

---

## 3. Better Context Management Visibility

*   **[DONE] Dynamic Context Window Usage:** A visual progress bar for context usage is now always visible in the status line, changing color (green/yellow/red) as the context window fills up.
*   **[DONE] Active File Context Display:** The UI now displays a list of "Files in context," showing which files the agent has recently accessed (read, written, or patched) in the current session.
*   **[DONE] Interactive Choices UX:** The UI now detects when the agent asks for confirmation (Yes/No) or proposes multiple choices formatted like `[Option A] [Option B]`. These are rendered as an interactive selection menu.
    *   **[DONE] Custom Response:** Added a "Custom..." option to interactive choices, allowing users to switch to text input for specific instructions.
*   **[DONE] Enhanced Memory Management:**
    *   **`query_memory` tool:** The agent can now specifically search the project memory for relevant facts.
    *   **`forget_memory` tool:** The agent can now identfy and remove outdated or incorrect entries from the project memory.
    *   **Automatic Context Injection:** Important facts in memory are automatically summarized and can be explicitly retrieved by the agent to maintain project-wide knowledge.

### Future Memory Improvements:
*   **[DONE] Memory Visualization Overlay:** A dedicated `/memory` overlay (similar to `/history`) has been implemented. it displays all stored facts, grouped by category, with an interactive interface to search and delete them.
*   **[DONE] Automated Memory Maintenance:** Implement a periodic "garbage collection" where the LLM reviews stored facts and suggests merging duplicates or archiving outdated information. Users can trigger this manually via \`/memory maintain\`.
    *   **[DONE] Context-Aware Memory Search:** Automatically perform a low-latency "semantic search" on the project memory for every user prompt, injecting only the most relevant snippets to save context tokens.
    *   **[DONE] Ollama Embeddings:** Supported local embeddings via Ollama using `nomic-embed-text:latest` or custom models.
    *   **[DONE] Ollama Server Customization:** Support for `OLLAMA_BASE_URL` to connect to remote servers.

* **Actionable Feedback and Error Handling:**
    *   **[DONE] Improved Shell Command Parsing:** The system now more robustly handles complex commands with quotes and operators. It intelligently detects when a command requires a shell and avoids over-quoting that could mangle variables or pipes.
    *   **[DONE] Guidance for LLM Failures:** Loop detection logic is implemented. If a tool call fails twice with the same error, the agent stops and asks for clarification, providing an explicit error message about the loop.
    *   **[DONE] Robust Argument Parsing:** Fixed an issue where the LLM's chosen format for commands (string vs array) could lead to execution errors. The parser now preserves intent for both formats.

## 5. Overall Polish and Usability

*   **Responsive Layout:** The UI utilizes `useTerminalSize` to adapt its rendering (e.g., Markdown width, truncated outputs) to the current terminal dimensions.
*   **Performance & Stability:**
    *   **[DONE] Listener Leak Fix:** Optimized terminal size hooks to use a single shared listener, preventing `MaxListenersExceededWarning`.
    *   **[DONE] Memory Efficiency:** Optimized session restoration to handle large history sets without crashing.
*   **Smart Auto-Scrolling:** Ink's default rendering handles basic scrolling, but further optimization for large chat histories is always considered.
*   **[DONE] Consolidated UI Footer:** Reorganized the UI to use a more compact and informative footer at the bottom of the screen, below the input box.
    *   **[DONE] Multi-line Status Bar:** The footer now spans two lines, consolidating model info, provider, approval mode, queued prompts, context usage, and session ID.
    *   **[DONE] Persistent Command Help:** Common shortcuts and slash commands are now always visible in the footer for easier discovery.
*   **[DONE] Multi-Provider Configuration:**
    *   **[DONE] Per-Provider Settings:** Users can now define unique API keys and base URLs for each provider (OpenAI, Google, Ollama, etc.) in their `config.json`.
*   **[DONE] Unified Google SDK Integration:**
    *   **[DONE] @google/genai Support:** Migrated to the new unified `@google/genai` SDK for better performance and reliability with Gemini models.
    *   **[DONE] Native Streaming:** Improved streaming response handling using native SDK iterators.
    *   **[DONE] Automatic Tool Sanitization:** Function names are now automatically sanitized to comply with Google's API requirements.
    *   **[DONE] Thought Signatures:** Fixed 400 errors by correctly capturing and restoring `thought_signature` during multi-turn Gemini conversations.
*   **[DONE] Improved User Input and Interaction:**
    *   **[DONE] Borderless Input Box:** Simplified the input area with a cleaner single-line border for a more modern terminal feel.
    *   **[DONE] Streamlined Suggestions:** Moved initial suggestions to the input placeholder to save vertical space.
*   **[DONE] Advanced Context Management:**
    *   **[DONE] File Pinning:** Users can now use `/pin` and `/unpin` to keep critical files always in the context window, regardless of conversation length.
    *   **[DONE] Context Breakdown Toggle:** A new `ctrl+b` shortcut toggles a detailed view of token usage, broken down by System instructions, History, and Tools.
    *   **[DONE] Ignored Files Visibility:** The `/ignored` command provides instant visibility into which files are being filtered out by Git/Codex ignore rules.
*   **[DONE] Customization & Productivity:**
    *   **[DONE] Dynamic JSON Theming:** Users can now define custom color mappings in their `config.json` to personalize the terminal UI.
    *   **[DONE] Prompt Recipes:** A new `/recipes` system provides a library of pre-defined prompt templates for common engineering tasks (testing, documentation, security, etc.).
---
*Last Updated: 2026-02-04*