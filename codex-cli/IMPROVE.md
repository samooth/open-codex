Potential Improvements:

   1. [DONE] Tool-Specific Advice:
       * Explicitly mention the new parallel execution capability. If the model needs information from multiple files, it should call multiple read_file tools in one turn to save time.
       * Encourage using read_file_lines for files over a certain size (e.g., > 500 lines) to preserve context window.

   2. [DONE] Dry-Run Awareness:
       * Tell the agent about the --dry-run flag. If it's active (which we can inject into the prompt), the agent should know its changes won't be committed and it might need to explain
         its reasoning more thoroughly.

   3. [DONE] Provider-Specific Formatting:
       * Migrated to native `@google/genai` SDK for Gemini models, ensuring optimal tool-calling and streaming performance. Implemented automatic name sanitization and thought signature handling for Google's API.
       * [NEW] Implemented multi-provider configuration support in `config.json`, allowing per-provider API keys and base URLs.

   25. [DONE] UI Reorganization:
       * Consolidated fragmented status information into a unified, compact multi-line footer at the bottom of the screen.
       * Simplified the main chat input area for a cleaner interface.
       * Added persistent shortcut hints to the footer for better discoverability.

   26. [DONE] Context Management:
       * Implemented file pinning (`/pin`, `/unpin`) to ensure core files stay in context.
       * Added detailed context token breakdown (`ctrl+b`) for precise monitoring.
       * Integrated ignored files preview (`/ignored`) to debug context exclusion.

   27. [DONE] Customization:
       * Supported dynamic JSON themes in `config.json` for custom ANSI color mapping.
       * Implemented `/recipes` for a curated library of common prompt templates.

   4. [DONE] Loop Protection Strategy:
       * Instruct the agent that if a command fails more than twice with the same error, it should stop and ask for clarification instead of retrying blindly.

   5. Structured Planing:
       * For complex tasks, encourage the model to output a <plan> block before executing, helping the user (and the model) track milestones.

   6. Knowledge of the "Project Memory":
       * Remind the agent that it can save important facts using the persistent_memory tool so it doesn't have to re-discover them in future sessions.

   7. [DONE] Interactive Prompt Adjustment:
       * Allow user to adjust the system prompt given to the LLM with `/prompt`.

   8. [DONE] Interactive Prompt Selection:
       * Allow user to select from multiple system prompt files with `/prompts`.

   9. [DONE] Ignore File Support:
       * Implemented `.codexignore` support across directory listing and search tools.

   10. [DONE] Session Persistence:
       * Implemented automatic session saving and `/history restore` command for continuing past work.

   11. [DONE] Web Search Integration:
       * Added `web_search` and `fetch_url` tools using Lynx with specialized UI rendering.

   12. [DONE] Deep Thinking Toggle:
       * Added configuration to enable/disable the default "Deep Thinking" prompt prefix.

   13. [DONE] Tool UX Overhaul:
       * Added semantic icons, labels, and intelligent argument summaries to tool calls and outputs.
       * [NEW] Integrated tool call and response into unified boxes.

   14. [DONE] Interactive Proceed Confirmation:
       * Detect model questions about continuing and show a Yes/No arrow-key selection.
       * Added "Custom..." option to allow arbitrary user text input.

   15. [DONE] Parallel Tool Call Flattening:
       * Automatically split concatenated JSON objects in tool call arguments into separate parallel executions.

   16. [DONE] Context-Aware Memory Search:
       * Automatically perform a low-latency "semantic search" on the project memory for every user prompt, injecting only the most relevant snippets to save context tokens.

   17. [DONE] Enhanced Tool Visibility & Boxes:
       * Tool calls and outputs are rendered in rounded boxes with color-coded status (red for failure).
       * "Tool Call Details" (name and arguments) are shown on error or in debug mode.

   18. [DONE] Empty Command Default:
       * Empty command arrays `{"cmd":[]}` now default to `ls -F`.

   19. [DONE] Ollama Customization:
       * Supported `OLLAMA_BASE_URL` environment variable for remote Ollama servers.
       * Added `embeddingModel` configuration to allow custom local embedding models.

   20. [DONE] Performance Optimizations:
       * Resolved memory leaks and `MaxListenersExceededWarning` by implementing a global shared terminal size hook.
       * Optimized session history restoration to handle hundreds of sessions without crashing.

   21. [DONE] Persistent Status Bar:
       * Real-time status bar showing model, provider, mode, context usage, and session ID.

   22. [DONE] Interactive History Search:
       * Filtered search for both current history and past session restoration.

   23. [DONE] Syntax Highlighting for Tool Output:
       * Automatic language-aware highlighting for file contents and search results.

   24. [DONE] Tool Robustness:
       * Parameter heuristics for `search_codebase` and aliases for `read_file_lines`.
       * Error logging to `opencodex.error.log`.