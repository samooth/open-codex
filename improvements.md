# Actionable Improvements for Open Codex

This list identifies high-impact features and refinements to enhance the Open Codex CLI experience, derived from a technical review of the current architecture.

## 1. IDE & Editor Integration
- **Native VS Code Extension**: A dedicated extension to provide a sidebar chat, inline diff decorations, and one-click execution of proposed shell commands.
- **Language Server Protocol (LSP) Integration**: Connect the agent to an LSP backend to provide real-time syntax checking and symbol resolution for the agent's internal reasoning.

## 2. Refined Interaction Model
- **Streaming Tool Output UI**: Refine the TUI to handle high-frequency streaming updates for long-running shell commands more smoothly, avoiding terminal flickering.
- **Interactive Hunk Selection**: Implement a more granular approval system where users can toggle individual diff hunks using the keyboard before applying a patch.
- **Agent Clipboard Access**: Provide a `clipboard` tool so the agent can read from or write to the system clipboard, facilitating better multi-app workflows.

## 3. Intelligence & Context Management
- **Token-Based History Truncation**: Replace the current message-count-based truncation with precise token-count truncation using the existing estimation logic to maximize context window usage.
- [DONE] **Incremental Semantic Indexing**: Optimize `SemanticMemory` to only re-index files that have changed on disk, significantly speeding up the `/index` command for large repos (implemented in `semantic-memory.ts`).
- [DONE] **Smart Context Retrieval**: Automatically "pull" relevant file snippets into context when the agent mentions them in a `<thought>` block or when they are modified (implemented in `agent-loop.ts`).

## 4. Extensibility
- [DONE] **Plugin System**: Implement a `PluginManager` that dynamically loads custom tool definitions and handlers from `~/.open-codex/plugins/`, allowing users to extend the agent's capabilities without modifying source code (implemented in `plugin-manager.ts`).

## 5. UI & Aesthetics
- **Responsive Layout Enhancements**: Further optimize the TUI for ultra-narrow terminals (e.g., sidebars) by dynamically hiding non-essential status bar elements.
- **Visual Task Progress**: Replace the static checklist with a more dynamic progress bar for long-running "multi-generation" tasks.
- **Theme Customization Tool**: An interactive CLI wizard to help users create and preview their own `.json` themes.

## 6. Developer Productivity & Stability
- **Robust Error Recovery 2.0**: Implement a "re-plan" protocol where the agent automatically analyzes tool failures and proposes an alternative approach without user intervention.
- **Automated Regression Testing**: A tool for developers to "record" a session and turn it into a deterministic integration test to prevent UI regressions.
- **Shell Environment Synchronization**: Automatically detect and mirror the user's shell environment (aliases, exported functions) within the agent's execution sandbox.
- **One-Click PR Preparation**: A specialized recipe that performs a final lint check, generates a conventional commit message, and stages the changes for a PR.
