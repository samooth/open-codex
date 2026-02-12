# OpenCodex TODO - Future Improvements & Roadmap

This document tracks planned features, architectural refinements, and UI/UX enhancements for the OpenCodex CLI.

## Urgent: Technical Debt & Stability

*   **[DONE] Fix `apply-patch.ts` Regressions:** Resolve the 7 failing tests in `tests/apply-patch.test.ts`. The recent refactors for robustness introduced regressions in hunk identification and context matching.
*   **[DONE] Consolidate Testing Framework:** Remove any remaining `mocha` dependencies and migrate fully to `vitest` for consistency.
*   **[ ] Character-Level Patch Debugging:** Finalize the character-level logging in `text_to_patch` to prevent whitespace-related context failures.

## High Priority: Productivity & Feedback

*   **[ ] Smart Context (Auto-Pinning):** Automatically detect and persist core files/interfaces into the session context based on access frequency and "centrality" to the codebase.
*   **[ ] Fetch Docs (Deep Crawl):** Expand `fetch_url` to intelligently crawl and summarize entire documentation sub-trees for new or unknown libraries.
*   **[ ] Cost Tracking:** Estimate and display the cost of the current session based on token usage and known model pricing.
*   **[ ] Command Re-run:** Add an interactive mode to select a previous shell command from history and hit `R` to re-populate the input or execute it immediately.

## UI/UX Enhancements

*   **[ ] Interactive Hunk Selection:** Allow users to pick specific "hunks" from an `apply_patch` instead of accepting/rejecting the whole file.
*   **[ ] Collapsible History Blocks:** Ability to collapse entire message turns (user + assistant response) to focus on the current task.
*   **[ ] Live Indexing Status:** A more subtle, non-blocking progress indicator for background semantic indexing.
*   **[ ] Audio Notifications:** Add an optional "ping" sound (toggleable in config) when a long-running task like indexing or deep-thinking finishes.

## Architecture & Logic

*   **[ ] Plugin System:** Define a formal interface for community-contributed tools and providers.
*   **[ ] Enhanced Linux Sandbox:** Move beyond basic containerization to use native Landlock or Linux Namespaces for tighter, lower-overhead isolation.
*   **[ ] Intelligent Context Rotation:** Instead of FIFO truncation, use the LLM or embeddings to "forget" the least relevant parts of the history when the window is full.
*   **[ ] Multi-Agent Coordination:** Allow the primary agent to spawn specialized sub-agents for specific sub-tasks (e.g., a "Test Agent" and a "Doc Agent").

## Code Quality & Testing

*   **[ ] E2E Integration Tests:** Full TTY simulation tests using tools like `expect` or advanced Ink testing wrappers.
*   **[ ] Performance Benchmarks:** Track token-to-output latency and indexing speed over time.
*   **[ ] Dependency Hardening:** Further restrict file system access based on the current project root and `.codexignore`.

---
*Last Updated: 2026-02-12*
