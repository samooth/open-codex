# UI/UX Roadmap: The Professional CLI Experience

This document tracks planned improvements for the OpenCodex terminal interface, focusing on performance, visual sophistication, and interactive polish.

## 1. Performance & Rendering (Anti-Flicker)

- [x] **History Virtualization (Windowing):** Implemented a windowing system to only render the last 30 turns in the active tree, significantly improving speed in long sessions.
- [x] **Incremental Markdown Rendering:** Developed a `LiteMarkdown` fast-path renderer for streaming chunks to avoid heavy AST re-parsing.
- [x] **Height-Stable Buffers:** Forced fixed heights for Input and Status Bar components, preventing vertical "jumping" during state transitions.
- [ ] **Render Throttling Optimization:** Refine the current 500ms throttle to be dynamic based on the volume of incoming streaming tokens.

## 2. Advanced Tooling Visuals

- [x] **Semantic Diff Highlighting:** Integrated character-level diffs with bold/background highlights for precise code review.
- [x] **Interactive Hunk Selection:** Users can now surgically toggle individual file hunks within a patch using arrow keys and the space bar.
- [x] **OSC 8 Hyperlinks:** Added terminal-native clickable links for file paths in headers and tool outputs.
- [x] **Terminal Graphics Protocol:** Implemented image thumbnail support for iTerm2, Kitty, and WezTerm.
- [x] **Enhanced Code Block Interaction:** Added a `Ctrl+Y` global shortcut to copy the last generated code block to the system clipboard.

## 3. Interactive Polish

- [x] **True Multi-line Support:** Enhanced the internal input component to handle newlines natively via `Shift+Enter` and submission via `Ctrl+Enter`.
- [x] **Unified Prompt Queue:** Multiple queued prompts are now merged and can be edited using the Up arrow when the agent is busy.
- [x] **Fuzzy Search Overlays:** Redesigned History, Model, Recipe, and Memory overlays with a consistent professional style and instantaneous filtering.
- [x] **Real-time Breadcrumbs:** Displayed the current file path being accessed by the agent in the header, with clickable OSC 8 support.
- [x] **TUI Configuration Dashboard:** Replaced basic settings with an interactive, professional dashboard with descriptions and theme support.
- [x] **Command Pallette:** Added a `Ctrl+P` global command search for quickly accessing all slash commands and recipes from a unified interface.

## 4. Visual Refinement

- [x] **Minimalist IDE Branding:** Transitioned from boxy borders to professional left-accent bars and high-signal typography.
- [x] **Unified Iconography:** Standardized icons and labels for a cohesive, professional look.
- [x] **Color Interpolation:** Added a subtle "active glow" to the tail of streaming assistant text to make it feel more dynamic and "alive."
- [x] **Context Usage Micro-Charts:** Replaced the character-based progress bar with high-resolution Unicode sparklines for token usage history in the status bar.
- [x] **Responsive Breakpoints:** Improved UI density and layout switching for narrow or short terminal windows.
- [x] **Collapsible History Blocks:** Added the ability to collapse entire message turns and tool outputs with the `C` key to manage screen real estate.
- [x] **Command Re-run History:** Added a `Ctrl+R` overlay to select and re-execute (or edit) previous shell commands.
- [x] **Live Indexing Status:** Integrated a non-blocking background indicator for codebase semantic indexing in the status bar.
