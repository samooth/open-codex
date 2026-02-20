# Sublime Text Integration for OpenCodex

You can integrate OpenCodex into your Sublime Text workflow using several methods, from simple build systems to interactive terminal tabs.

## 1. Build System (Fastest)

Standard Sublime build files do not have a native variable for selected text. To fix this, you need a two-part setup: a small Python plugin and a custom build file.

### Step A: Create the Helper Plugin
This plugin adds logic to handle selections, fallback to the entire file, and pipe content securely via temporary files to avoid shell quoting issues.

1. In Sublime, go to **Tools** > **Developer** > **New Plugin...**
2. Replace the contents with the following:
```python
import sublime
import sublime_plugin
import tempfile
import os
import shlex

class BuildWithSelectionCommand(sublime_plugin.WindowCommand):
    def run(self, **kwargs):
        view = self.window.active_view()
        if not view: return

        if view.settings().get('is_widget'):
            view = self.window.views()[0]

        filename = view.file_name()
        ext = os.path.splitext(filename)[1] if filename else ".txt"

        region = view.sel()[0]
        if region.empty():
            text_to_use = view.substr(sublime.Region(0, view.size()))
        else:
            text_to_use = view.substr(region)

        with tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix=ext, encoding='utf-8') as tmp:
            tmp.write(text_to_use)
            tmp_path = tmp.name

        # Reconstruct command preserving flags
        # We quote args to ensure safety in the shell
        cmd_args = kwargs.get('cmd', [])
        quoted_args = [shlex.quote(arg) for arg in cmd_args if arg != "$selection"]
        
        base_cmd = " ".join(quoted_args)
        final_cmd = f'{base_cmd} < "{tmp_path}"'
        
        print(f"Running: {final_cmd}")

        if 'cmd' in kwargs: del kwargs['cmd']
        kwargs['shell_cmd'] = final_cmd

        self.window.run_command('exec', kwargs)
```
3. Save it as `build_with_selection.py` in your `User` folder.

### Step B: Create the Build File
Now create a build file that uses the new `target`.

1. Go to **Tools** > **Build System** > **New Build System...**
2. Paste the following configuration:
```json
{
    "target": "build_with_selection",
    "working_dir": "$project_path",
    "selector": "source",
    "cmd": ["open-codex", "Analyze this project:"],
    "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434/v1"
    },
    // Optional: Add your node path if open-codex isn't found
    // "path": "/usr/local/bin:$PATH" 
}
```
3. Save it as `OpenCodex.sublime-build`.
4. **To use**: Highlight code (or don't, to use the whole file) and press `Ctrl+B`.

## Configuration & API Keys

Since the Sublime Build System runs in a non-interactive shell, it needs access to your API keys and configuration.

### Option A: Inline (Build System only)
You can specify your provider and configuration directly in your `OpenCodex.sublime-build` file:

```json
{
    "target": "build_with_selection",
    "cmd": ["open-codex", "--provider", "ollama", "-m", "cogito:14b", "Analyze this project:"],
    "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434/v1"
    },
    "working_dir": "$project_path",
    "selector": "source"
}
```

### Option B: Global Config (Recommended)
OpenCodex reads from `~/.codex/config.json`. Setting your configuration here makes it available everywhere:

```json
{
  "provider": "ollama",
  "providers": {
    "ollama": {
      "baseURL": "http://192.168.1.100:11434/v1"
    }
  }
}
```

### Option C: Project-local `.env`
If you have a `.env` file in your project's root directory:
```env
OLLAMA_BASE_URL=http://192.168.1.100:11434/v1
```

## 2. Terminus Integration (Recommended)

Since OpenCodex is interactive, it works best inside a real terminal. The **Terminus** plugin provides the best experience.

1. Install **Terminus** via Package Control.
   * *Troubleshooting*: If you can't find Terminus, check `Preferences` > `Settings` and ensure it's not in the `"ignored_packages"` list.
   * *Manual Install*: If Package Control still fails, you can install it via git:
     ```bash
     # Linux
     cd ~/.config/sublime-text/Packages
     git clone https://github.com/randy3k/Terminus.git
     ```
2. Open your keybindings (**Preferences** > **Key Bindings**).
3. Add this shortcut to open Codex in a new tab:
```json
{
    "keys": ["ctrl+alt+c"],
    "command": "terminus_open",
    "args": {
        "cmd": ["open-codex"],
        "cwd": "${project_path:${folder}}",
        "title": "OpenCodex"
    }
}
```
4. Now, pressing `Ctrl+Alt+C` will launch an interactive Codex session rooted in your project directory.

## 3. "Terminal" Plugin Integration (External)

If you have the **Terminal** package (by wbond) installed instead of Terminus, it will open your system's native terminal (e.g., GNOME Terminal, xterm) instead of an internal tab.

1. Install **Terminal** via Package Control.
2. Open your keybindings (**Preferences** > **Key Bindings**).
3. Add a shortcut to open a terminal and immediately run Codex:
```json
{
    "keys": ["ctrl+shift+c"],
    "command": "open_terminal",
    "args": {
        "parameters": ["-e", "open-codex"]
    }
}
```
*Note: The `-e` flag works for most Linux terminals. Use `--` or specific flags for your terminal if needed.*

## 4. Right-Click Context Menu Plugin

You can add a "Ask OpenCodex" option to your right-click menu that opens a terminal window with your selection.

1. Go to **Preferences** > **Browse Packages...** and open the `User` folder.
2. Create a file named `AskCodex.py` and paste:
```python
import sublime
import sublime_plugin
import subprocess
import os

class AskCodexCommand(sublime_plugin.TextCommand):
    def run(self, edit):
        selection = self.view.substr(self.view.sel()[0])
        if not selection:
            sublime.error_message("Please select some code first.")
            return
        
        # Opens an external terminal. 
        # For Linux (GNOME):
        subprocess.Popen(['gnome-terminal', '--', 'open-codex', selection])
        
        # For macOS, use:
        # subprocess.Popen(['osascript', '-e', f'tell application "Terminal" to do script "open-codex {selection}"'])
```
3. Create another file in the same folder named `Context.sublime-menu`:
```json
[
    { "caption": "Ask OpenCodex", "command": "ask_codex" }
]
```

## 4. Automatic Context via `codex.md`

OpenCodex is context-aware. If you keep a `codex.md` file in your project root, you can use Sublime to update your project rules or "pinned" facts. OpenCodex will automatically read this file every time it runs a command, ensuring it always follows your latest project guidelines.
