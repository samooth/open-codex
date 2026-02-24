# OpenCodex Recipes

Below are a few bite‑size examples you can copy‑paste. Replace the text in quotes with your own task. See the [prompting guide](https://github.com/samooth/open-codex/blob/main/codex-cli/examples/prompting_guide.md) for more tips and usage patterns.

| ✨  | What you type                                                                   | What happens                                                               |
| --- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `open-codex "Refactor the Dashboard component to React Hooks"`                       | Codex rewrites the class component, runs `npm test`, and shows the diff.   |
| 2   | `open-codex "Generate SQL migrations for adding a users table"`                      | Infers your ORM, creates migration files, and runs them in a sandboxed DB. |
| 3   | `open-codex "Write unit tests for utils/date.ts"`                                    | Generates tests, executes them, and iterates until they pass.              |
| 4   | `open-codex "Bulk‑rename *.jpeg → *.jpg with git mv"`                                | Safely renames files and updates imports/usages.                           |
| 5   | `open-codex "Explain what this regex does: ^(?=.*[A-Z]).{8,}$"`                      | Outputs a step‑by‑step human explanation.                                  |
| 6   | `open-codex "Carefully review this repo, and propose 3 high impact well-scoped PRs"` | Suggests impactful PRs in the current codebase.                            |
| 7   | `open-codex "Look for vulnerabilities and create a security review report"`          | Finds and explains security bugs.                                          |

---

## 🆘 Emergency & Recovery

Sometimes things don't go as planned. OpenCodex includes built-in tools to help you recover:

- **Mistake in the last turn?** Type `/undo` to revert the last conversation turn and restore any files that were modified or deleted.
- **Lost in the chat?** Type `/clear` to reset the context window and start a fresh session (this doesn't delete your files, only the AI's "short-term memory").
- **Want to see what *would* happen?** Use the `--dry-run` flag to preview all file changes and shell commands without executing them.
