# Non‑interactive / CI mode

Run Codex head‑less in pipelines. Codex will automatically detect if it's running in a non-TTY environment and enable quiet mode if a prompt is provided.

Prompts can be passed as command-line arguments or piped via **stdin**:

```bash
echo "explain this project" | open-codex
```

Example GitHub Action step:

```yaml
- name: Update changelog via Codex
  run: |
    npm install -g @samooth/open-codex
    export OPENAI_API_KEY="${{ secrets.OPENAI_KEY }}"
    open-codex -a auto-edit "update CHANGELOG for next release"
```

You can also explicitly enable it with the `--quiet` flag or by setting `CODEX_QUIET_MODE=1`.
