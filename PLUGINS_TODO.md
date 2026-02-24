# Plugin System TODO

This document tracks the implementation of the OpenCodex Plugin System, allowing for extensible tools and providers.

## Phase 1: Foundation (Type & Registry)
- [ ] Define `CodexPlugin` and `PluginContext` interfaces in `src/utils/agent/types.ts`.
- [ ] Create `src/utils/plugins/plugin-registry.ts` to manage in-memory plugins.
- [ ] Update `AgentLoop` to accept and utilize the `PluginRegistry`.

## Phase 2: Dynamic Loading
- [ ] Implement `src/utils/plugins/plugin-loader.ts` for dynamic `import()` of plugins.
- [ ] Add scanning logic for `~/.codex/plugins/` and project-local `.codex/plugins/`.
- [ ] Implement basic "Hot Reload" support for plugin development.

## Phase 3: Agent Integration
- [ ] Update `AgentLoop.run()` to merge plugin-defined tools into the model's toolset.
- [ ] Update `handleFunctionCall()` to route execution to the appropriate plugin handler.
- [ ] Ensure plugin tools respect the session's `ApprovalPolicy`.

## Phase 4: UI & Developer Experience
- [ ] Implement `/plugins` slash command to list active extensions.
- [ ] Create a plugin scaffolding tool or recipe.
- [ ] Add plugin configuration (enable/disable) to `config.json`.

## Security & Validation
- [ ] Implement `zod` validation for plugin manifests and tool schemas.
- [ ] Restrict plugin access to core internals through a controlled `PluginContext`.
- [ ] Audit shell command execution within plugins to ensure approval compliance.
