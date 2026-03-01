Potential Improvements:

1.  [DONE] Tool-Specific Advice:

    - Explicitly mention the new parallel execution capability. If the model needs information from multiple files, it should call multiple read_file tools in one turn to save time.
    - Encourage using read_file_lines for files over a certain size (e.g., > 500 lines) to preserve context window.

2.  [DONE] Web Research Robustness:

    - Consolidated web interaction into a single `browse` tool.
    - Fixed a bug where the base system prompt (including browsing instructions) was skipped when Deep Thinking was disabled.
    - Strengthened browsing instructions in the system prompt to prevent the model from claiming it has no internet access.

3.  [DONE] Dry-Run Awareness:

    - Tell the agent about the --dry-run flag. If it's active (which we can inject into the prompt), the agent should know its changes won't be committed and it might need to explain
      its reasoning more thoroughly.

4.  [DONE] Provider-Specific Formatting:

    - Migrated to native `@google/genai` SDK for Gemini models, ensuring optimal tool-calling and streaming performance. Implemented automatic name sanitization and thought signature handling for Google's API.
    - [NEW] Implemented multi-provider configuration support in `config.json`, allowing per-provider API keys and base URLs.

5.  [DONE] UI Reorganization:

    - Consolidated fragmented status information into a unified, compact multi-line footer at the bottom of the screen.
    - Simplified the main chat input area for a cleaner interface.
    - Added persistent shortcut hints to the footer for better discoverability.

6.  [DONE] Context Management:

    - Implemented file pinning (`/pin`, `/unpin`) to ensure core files stay in context.
    - Added detailed context token breakdown (`ctrl+b`) for precise monitoring.
    - Integrated ignored files preview (`/ignored`) to debug context exclusion.

7.  [DONE] Customization:

    - Supported dynamic JSON themes in `config.json` for custom ANSI color mapping.
    - Implemented `/recipes` for a curated library of common prompt templates.

8.  [DONE] Grounding & Anti-Hallucination:

    - Implemented a strict Grounding Protocol in the system prompt to prevent guessing paths or library APIs.
    - Automatically inject `package.json` dependencies into the system prompt context to provide a factual baseline of the environment.

9.  [DONE] Refined Interaction Menus:

    - Improved regex-based detection for Yes/No questions and multi-choice `[Option]` lists.
    - Formalized the selection protocol in the system prompt to allow the model to reliably trigger interactive UI buttons.
    - Added `Esc` key shortcut to quickly switch to "Custom..." input mode.

10. [DONE] Reasoning Persistence:

    - Resolved an issue where `reasoning_content` (from models like o1 or o3-mini) would disappear from history once streaming finished.
    - Added specific unit tests for reasoning-only message rendering.

11. [DONE] Type Safety & DX:

    - Resolved 20+ core TypeScript errors across 6 files, fixing issues with tool-call union types and broken imports.
    - Optimized system-prompt string handling to prevent template literal termination errors.
    - Fixed `fileURLToPath` crashes and component hoisting in `TerminalChatResponseItem`.

12. [DONE] Advanced Input Experience:

    - Implemented True Multi-line support using `Shift+Enter` for newlines.
    - Added `Ctrl+Enter` as a primary submission shortcut for multi-line prompts.
    - Improved fake cursor rendering to handle multiline wrap and newlines correctly.

13. [DONE] Enhanced Visual Clarity:

    - Standardized link colors to `cyanBright` with underlines across the entire UI (Header, Markdown, and Tool Outputs) to ensure visibility against dark terminal backgrounds.

14. [DONE] Loop Protection Strategy:

    - Instruct the agent that if a command fails twice with the same error, it should stop and ask for clarification instead of retrying blindly.

15. [DONE] Structured Planing:

    - For complex tasks, encourage the model to output a <plan> block before executing, helping the user (and the model) track milestones.

16. [DONE] Knowledge of the "Project Memory":

    - Remind the agent that it can save important facts using the persistent_memory tool so it doesn't have to re-discover them in future sessions.

17. [DONE] Interactive Prompt Adjustment:

    - Allow user to adjust the system prompt given to the LLM with `/prompt`.

18. [DONE] Interactive Prompt Selection:

    - Allow user to select from multiple system prompt files with `/prompts`.

19. [DONE] Ignore File Support:

    - Implemented `.codexignore` support across directory listing and search tools.

20. [DONE] Session Persistence:

    - Implemented automatic session saving and `/history restore` command for continuing past work.

21. [DONE] Web Search Integration:

    - Added `web_search` and `fetch_url` tools using Lynx with specialized UI rendering.

22. [DONE] Deep Thinking Toggle:

    - Added configuration to enable/disable the default "Deep Thinking" prompt prefix.

23. [DONE] Tool UX Overhaul:

    - Added semantic icons, labels, and intelligent argument summaries to tool calls and outputs.
    - [NEW] Integrated tool call and response into unified boxes.

24. [DONE] Interactive Proceed Confirmation:

    - Detect model questions about continuing and show a Yes/No arrow-key selection.
    - Added "Custom..." option to allow arbitrary user text input.

25. [DONE] Parallel Tool Call Flattening:

    - Automatically split concatenated JSON objects in tool call arguments into separate parallel executions.

26. [DONE] Context-Aware Memory Search:

    - Automatically perform a low-latency "semantic search" on the project memory for every user prompt, injecting only the most relevant snippets to save context tokens.

27. [DONE] Enhanced Tool Visibility & Boxes:

    - Tool calls and outputs are rendered in rounded boxes with color-coded status (red for failure).
    - "Tool Call Details" (name and arguments) are shown on error or in debug mode.

28. [DONE] Empty Command Default:

    - Empty command arrays `{"cmd":[]}` now default to `ls -F`.

29. [DONE] Ollama Customization:

    - Supported `OLLAMA_BASE_URL` environment variable for remote Ollama servers.
    - Added `embeddingModel` configuration to allow custom local embedding models.

30. [DONE] Performance Optimizations:

    - Resolved memory leaks and `MaxListenersExceededWarning` by implementing a global shared terminal size hook.
    - Optimized session history restoration to handle hundreds of sessions without crashing.

31. [DONE] Persistent Status Bar:

    - Real-time status bar showing model, provider, mode, context usage, and session ID.

32. [DONE] Interactive History Search:

    - Filtered search for both current history and past session restoration.

33. [DONE] Syntax Highlighting for Tool Output:

    - Automatic language-aware highlighting for file contents and search results.

34. [DONE] Tool Robustness:

    - Parameter heuristics for `search_codebase` and aliases for `read_file_lines`.
    - Error logging to `opencodex.error.log`.

35. [DONE] Surgical Editing (edit_file):

    - Implemented a robust Search & Replace tool that requires exact matching, preventing common context-drift errors in patches.
    - Added side-by-side/unified diff generation for user review in the terminal.

36. [DONE] Code Intelligence (read_symbols / search_symbols):

    - Added lightweight symbol extraction to survey large file structures without context overflow.
    - Enhanced semantic search to specifically target and boost code definitions.

37. [DONE] Automated Verification (run_diagnostics):

    - Built a smart health-check tool that detects project types (Node, Rust, Go, Python) and runs lint/type-check/test suites automatically.

38. [DONE] Interactive Roadmap (update_tasks):

    - Implemented a persistent, flicker-free task checklist in the CLI footer to track multi-step goals.

39. [DONE] Safety & Recovery (checkpoint):

    - Created a tool to generate named git checkpoints (tags) before risky refactorings, allowing instant rollback.

40. [DONE] Thinking UI Stability:

    - Increased long delay warning to 45s and decoupled turn timer from reasoning chunks to prevent visual resets.

41. [DONE] Deep Linter Feedback:

    - Automatically trigger project linters (ESLint, Ruff, cargo check) after patches and pipe errors back to the model for self-correction. Configurable via TUI.

42. [DONE] Smart Context (Auto-Pinning):

    - Automatically detect and persist core files/interfaces into the session context based on access frequency. Enabled by default.

43. [DONE] Interactive Hunk Selection:
    - Allow users to pick specific "hunks" from an `apply_patch` instead of the whole file. (Using space to toggle)

TODO List (Future Improvements):

- **Cost & Token Auditing:** Real-time price estimation per turn/session based on actual token usage and model pricing.
- **Hybrid Search:** Combine ripgrep keyword matching with semantic vector embeddings for more accurate and comprehensive code discovery.
- **Image Generation Support:** Integrate Imagen 4.0 models for generating UI mockups or assets directly from the CLI.
- **Diff Chunking:** Automatically break down extremely large patches into smaller, verifiable hunks to reduce the risk of "Invalid Context" errors.
- **Undo Buffer:** Implement a `/undo` command that rolls back the last file modification using git or temporary backups.
- **Fetch Docs (Deep Crawl):** Expand `fetch_url` to intelligently crawl and summarize entire documentation sub-trees for new libraries.
