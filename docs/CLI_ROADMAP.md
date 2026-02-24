# OpenCodex TODO - Future Improvements & Roadmap

This document tracks planned features, architectural refinements, and UI/UX enhancements for the OpenCodex CLI.

## Urgent: Technical Debt & Stability

*   **[DONE] Fix `apply-patch.ts` Regressions:** Resolve the failing tests in `tests/apply-patch.test.ts`.
*   **[DONE] Consolidate Testing Framework:** Migrated fully to `vitest` for consistency.
*   **[DONE] Resolve Component Initialization Crashes:** Fixed `fileURLToPath` imports and component hoisting in `TerminalChatResponseItem`.
*   **[DONE] Unified Web Browser:** Created the `browse` tool to intelligently handle searching, fetching, and site-specific research.
*   **[ ] Character-Level Patch Debugging:** Finalize the character-level logging in `text_to_patch` to prevent whitespace-related context failures.

## High Priority: Productivity & Feedback

*   **[DONE] True Multi-line Support:** Integrated `MultilineTextEditor` into the main chat input with `Shift+Enter`, `Ctrl+J`, and `Alt+Enter` for newlines and `Ctrl+Enter` for submission.
*   **[DONE] Variable/File Injection (`{{file}}`):** Automatically inject file contents into prompts using template syntax.
*   **[DONE] Command Re-run:** Added a dedicated `Ctrl+R` history overlay to select and edit previous shell commands.
*   **[DONE] Global Shell Focus Mode:** Added `Ctrl+F` to pipe `stdin` to interactive shell commands.
*   **[DONE] Web Search by Default:** Enabled web research capabilities for all sessions by default and consolidated into a robust `browse` tool.
*   **[DONE] SearXNG Integration:** Support for custom, privacy-focused search instances with JSON API integration.
*   **[DONE] Smart Context (Auto-Pinning):** Automatically detect and persist core files into the session context based on access frequency.
*   **[ ] Cost Tracking:** Estimate and display the cost of the current session based on token usage.

## UI/UX Enhancements

*   **[DONE] Interactive Hunk Selection:** Allow users to pick specific "hunks" from an `apply_patch` instead of the whole file. (Using space to toggle)
*   **[DONE] Improved Interaction Detection:** Fixed "How" questions triggering Yes/No prompts and refined detection logic to distinguish strong vs weak triggers.
*   **[DONE] Improved Visibility:** Fixed dark blue links in terminal outputs to use visible `cyanBright` with underlines.
*   **[DONE] Esc key for Custom Prompts:** Made the `Esc` key automatically select "Custom..." mode in interactive prompts.
*   **[DONE] Response Stability:** Refactored Markdown renderer to use robust placeholders for code blocks, preventing rendering glitches.
*   **[DONE] Collapsible History Blocks:** Ability to collapse large tool outputs and assistant turns using the `C` key.
*   **[DONE] Live Indexing Status:** Integrated background progress indicator for semantic indexing in the status bar.
*   **[DONE] Responsive Breakpoints:** Improved UI density and layout switching for narrow terminal windows.
*   **[DONE] Clearer AI State Feedback:** Loading indicator now maps specific tool calls to human-readable actions.
*   **[DONE] Command Palette Discoverability:** Added a subtle `Ctrl+P` hint in the status bar.

## Architecture & Logic

*   **[IN PROGRESS] Plugin System:** Foundation and dynamic loading implemented. Next: Hot reloading and community plugins.
*   **[ ] Enhanced Linux Sandbox:** Move beyond basic containerization to use native Landlock or Linux Namespaces.
*   **[ ] Intelligent Context Rotation:** Use the LLM or embeddings to "forget" the least relevant parts of the history.
*   **[ ] Multi-Agent Coordination:** Allow the primary agent to spawn specialized sub-agents for specific sub-tasks.

## Code Quality & Testing

*   **[DONE] UI Regression Testing:** Updated `terminal-chat-response-item.test.tsx` to verify new component layouts and logic.
*   **[ ] E2E Integration Tests:** Full TTY simulation tests using tools like `expect` or advanced Ink testing wrappers.
*   **[ ] Performance Benchmarks:** Track token-to-output latency and indexing speed over time.

---
*Last Updated: 2026-02-20*
