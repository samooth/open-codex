# UI Improvement Suggestions for OpenCodex CLI - Status Update

Here is the current state of UI improvements for the OpenCodex CLI:

*   **[DONE] Support for `<think>` tags:** The UI now correctly parses and styles `<think>` blocks output by deep-thinking models, rendering them in a distinct, italicized, and dimmed box.
    *   **[DONE] Scrolling Reasoning:** A scrolling mechanism within the thinking indicator has been implemented, allowing users to navigate through lengthy partial reasoning using the arrow keys.
    *   **[DONE] Active Tool Indicator:** The active tool name (e.g., `shell`, `read_file`) is now displayed within the thinking indicator.
    *   **[DONE] Empty Command Fallback:** If the model emits an empty command block (e.g., `command {}`), the system now defaults to executing `ls .` to help the model gather context about the current directory.
    *   **[DONE] Tool Arguments Preview:** A concise preview of tool arguments is now shown next to the active tool name.
*   **Structured Tool Output Display:**
---
## 2. Improved User Input and Interaction

*   **[DONE] Visual Prompt Queue:** 
    *   A small indicator showing the number of queued prompts is displayed in the status line.
    *   Input is always visible and active, even when the agent is busy; new inputs are automatically queued.
*   **[DONE] Slash Command Suggestions:** When the user types `/`, a list of available slash commands (e.g., `/model`, `/clear`, `/history`) with descriptions is displayed above the input area. Users can navigate these suggestions using arrow keys or Tab and select them with Return.
*   **[DONE] Enhanced Command History:** 
---
## 3. Better Context Management Visibility

*   **[DONE] Dynamic Context Window Usage:** A visual progress bar for context usage is now always visible in the status line, changing color (green/yellow/red) as the context window fills up.
*   **[DONE] Active File Context Display:** The UI now displays a list of "Files in context," showing which files the agent has recently accessed (read, written, or patched) in the current session.
*   **[DONE] Enhanced Memory Management:**
    *   **`query_memory` tool:** The agent can now specifically search the project memory for relevant facts.
    *   **`forget_memory` tool:** The agent can now identfy and remove outdated or incorrect entries from the project memory.
    *   **Automatic Context Injection:** Important facts in memory are automatically summarized and can be explicitly retrieved by the agent to maintain project-wide knowledge.

### Future Memory Improvements:
*   **[DONE] Memory Visualization Overlay:** A dedicated `/memory` overlay (similar to `/history`) has been implemented. it displays all stored facts, grouped by category, with an interactive interface to search and delete them.
*   **[DONE] Automated Memory Maintenance:** Implement a periodic "garbage collection" where the LLM reviews stored facts and suggests merging duplicates or archiving outdated information. Users can trigger this manually via \`/memory maintain\`.
*   **Context-Aware Memory Search:** Automatically perform a low-latency "semantic search" on the project memory for every user prompt, injecting only the most relevant snippets to save context tokens.

## 4. Actionable Feedback and Error Handling

*   **[DONE] Guidance for LLM Failures:** Loop detection logic is implemented. If a tool call fails twice with the same error, the agent stops and asks for clarification, providing an explicit error message about the loop.

## 5. Overall Polish and Usability

*   **Responsive Layout:** The UI utilizes `useTerminalSize` to adapt its rendering (e.g., Markdown width, truncated outputs) to the current terminal dimensions.
*   **Smart Auto-Scrolling:** Ink's default rendering handles basic scrolling, but further optimization for large chat histories is always considered.

---
*Last Updated: 2026-01-31*