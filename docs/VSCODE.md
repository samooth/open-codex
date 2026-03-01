# VS Code Integration for OpenCodex

Integrating OpenCodex into Visual Studio Code (VS Code) allows you to use its powerful repository-wide maintenance tools directly from your editor. You can use it via the integrated terminal, define custom tasks, and map them to keyboard shortcuts.

## 1. Integrated Terminal (Fastest)

Since OpenCodex is an interactive CLI, you can run it directly from the VS Code integrated terminal (`Ctrl+` ` `):

```bash
# Run the interactive chat
open-codex

# Analyze a specific topic or file
open-codex "Explain the logic in src/app.tsx"
```

## 2. Tasks Configuration (`tasks.json`)

VS Code Tasks allow you to automate commands and map them to the UI or shortcuts. You can define these in your project's `.vscode/tasks.json` file.

### Step A: Open `tasks.json`
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS).
2. Type `Tasks: Configure Task`.
3. Select `Create tasks.json file from template` and choose `Others`.

### Step B: Add OpenCodex Tasks
Paste the following configuration into your `tasks.json`:

```json
{
    "version": "2.0.0",
    "tasks": [
        {
            "label": "OpenCodex: Chat",
            "type": "shell",
            "command": "open-codex",
            "problemMatcher": [],
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": true,
                "panel": "new",
                "showReuseMessage": false,
                "clear": true
            },
            "group": "none"
        },
        {
            "label": "OpenCodex: Analyze Selection",
            "type": "shell",
            "command": "open-codex 'Analyze this snippet: ${selectedText}'",
            "problemMatcher": [],
            "presentation": {
                "echo": true,
                "reveal": "always",
                "focus": true,
                "panel": "new",
                "showReuseMessage": false,
                "clear": true
            },
            "group": "none"
        }
    ]
}
```

## 3. Keyboard Shortcuts (`keybindings.json`)

You can map these tasks to keyboard shortcuts for quick access.

1. Press `Ctrl+Shift+P`.
2. Type `Preferences: Open Keyboard Shortcuts (JSON)`.
3. Add the following shortcuts:

```json
[
    {
        "key": "ctrl+alt+c",
        "command": "workbench.action.tasks.runTask",
        "args": "OpenCodex: Chat"
    },
    {
        "key": "ctrl+alt+a",
        "command": "workbench.action.tasks.runTask",
        "args": "OpenCodex: Analyze Selection",
        "when": "editorHasSelection"
    }
]
```

## 4. Configuration & API Keys

### Option A: Project-local `.env`
OpenCodex automatically reads from a `.env` file in your project's root:
```env
# Example .env
OPENAI_API_KEY=your_api_key_here
OLLAMA_BASE_URL=http://localhost:11434/v1
```

### Option B: VS Code Environment
You can also set environment variables directly in your `tasks.json` if you don't want to use a `.env` file:

```json
{
    "label": "OpenCodex: Chat",
    "type": "shell",
    "command": "open-codex",
    "options": {
        "env": {
            "OLLAMA_BASE_URL": "http://localhost:11434/v1"
        }
    }
}
```

### Option C: Global Config (Recommended)
OpenCodex reads from `~/.open-codex/config.json`. This is the best place for persistent configurations that should be available across all projects.

## 5. Automatic Context via `open-codex.md`

Like in other integrations, keeping a `open-codex.md` file in your project root allows OpenCodex to be context-aware. Use VS Code to update your project rules or "pinned" facts, and OpenCodex will automatically incorporate them into every request.

---

For more information on using OpenCodex, see the [Main README](../README.md).
