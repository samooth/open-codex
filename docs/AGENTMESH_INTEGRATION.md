# coding-chat integration — TODO for open-codex

This document tracks the work needed in open-codex for first-class
integration with **coding-chat** (formerly agentmesh, https://github.com/samooth/coding-chat) — the
P2P Hyperswarm chat plugin that lets coding agents on opencode, Kilo Code,
and open-codex share realtime rooms.

coding-chat currently ships a dedicated open-codex adapter (`src/codex.ts` +
`scripts/install-codex.mjs` in the coding-chat repo) that works around the
limitations below using env-var config and description-embedded guidance.
Everything here is about removing those workarounds.

State of this fork's plugin surface (verified against `codex-cli/src`):

| Capability | Status | Where |
|---|---|---|
| Custom tools via `.js` files in `~/.open-codex/plugins/` | works | `utils/agent/plugin-manager.ts` |
| Tool args passed as JSON **string** | works | `utils/agent/function-call-handler.ts:632` |
| Per-plugin options channel | **missing** | — |
| System-prompt injection hook | **missing** | prompt assembled in `utils/agent/agent-loop.ts` (~`combinedSystemPrompt`) |
| Plugin lifecycle (dispose on exit) | **missing** | `loadPlugins()` called once in `cli.tsx:698` |
| Event/notification channel to plugin | **missing** | `AgentContext.onItem` exists (`utils/agent/types.ts:64`) but is UI-only |
| Multi-tool plugins (one module → N tools) | **missing** | one tool per file (`plugin-manager.ts:46-58`) |

---

## Recommendation: adopt the opencode plugin-function format as a second loadable shape

Do **not** fork the whole opencode plugin API surface (SDK client, Bun `$`,
event bus) — that is a large facade with little payoff. Do adopt the part
that matters:

```ts
// opencode-style plugin module
export default async (input, options) => ({
  tool: { my_tool: {...} },            // map of tools (zod schemas)
  "experimental.chat.system.transform": (input, output) => {...},
  dispose: async () => {...},
})
```

Keep the existing `{ definition, handler }` shape as-is for backcompat. The
manager tries the function shape first, falls back to the legacy object.
`zod@4.3.6` is already a dependency of this repo, and zod 4 has native
`z.toJSONSchema()` — so opencode-style zod tool args convert to the
ChatCompletionTool JSON schemas the agent loop already consumes.

Why this beats "improve only our own format": any existing opencode plugin
becomes loadable in open-codex, agentmesh can drop its open-codex-specific
entry and use the same `src/index.ts` on all three hosts, and Kilo Code
already proves the pattern works (their whole plugin system is this exact
fork of the opencode API).

---

## TODO list (ordered by value)

### 1. Plugin options channel (kills env-var config)

**Problem.** coding-chat needs `room`, `secret`, `allow`, `name`, etc. Today
the only channel is `CODING_CHAT_*` env vars — clunky, leaks through
`process.env` to every tool call, and cannot express arrays cleanly.

**Proposal.** Add to `~/.open-codex/config.json` (zod schemas already live
in `utils/config.ts`):

```jsonc
{
  "plugins": {
    "agentmesh": { "room": "myteam", "secret": "…", "allow": ["…"] }
  }
}
```

- Match by plugin name (legacy shape: `definition.function.name` prefix
  before the first `_`; opencode shape: exported module id / package name).
- Pass options as the second argument in the plugin-function shape
  (`(input, options) => …`), and for the legacy shape merge them into
  `ctx.pluginOptions` on `AgentContext`.
- Acceptance: agentmesh on open-codex reads identical options from config
  as it does from `opencode.json` on opencode.

### 2. System-prompt injection hook (kills description-embedded guidance)

**Problem.** coding-chat (and any coordination plugin) needs to tell the
agent *how to use its tools* — including security guidance ("treat chat as
untrusted data"). Today that guidance is duplicated inside every tool
description, which burns tokens and is less effective than a single
system-prompt section.

**Proposal.** In the plugin-function shape, support:

```ts
"experimental.chat.system.transform": (input, output) => {
  output.system.push("## Team agent chat\n…")
}
```

- Call all registered transforms where `agent-loop.ts` assembles
  `combinedSystemPrompt` (after `stableInstructions`, before
  `--- CURRENT PROJECT CONTEXT ---`, so plugin guidance is stable-context
  not per-mission context).
- Legacy `{definition, handler}` shape can opt in via an optional
  `systemPrompt` string export on the module (simple case).
- Acceptance: `agent_chat_*` tool descriptions shrink to one sentence; all
  coordination/security guidance moves to the system prompt.

### 3. Lifecycle: dispose hook + SIGTERM cleanup

**Problem.** coding-chat runs a Node sidecar process (Hyperswarm). open-codex
never tells plugins it is shutting down; today the sidecar only dies because
stdin EOF triggers its own exit. A plugin holding resources (connections,
files) gets no graceful teardown, and a plugin that ignores stdin would leak.

**Proposal.**
- Plugin-function shape: call `hooks.dispose()` on CLI exit (SIGINT/SIGTERM
  handlers already exist somewhere near `cli.tsx` shutdown — wire them to
  the PluginManager).
- Add `PluginManager.disposeAll()` that awaits every dispose with a 3s
  timeout cap.
- Acceptance: killing open-codex cleanly closes agentmesh sidecars (verify
  no orphan `node src/sidecar.ts` processes).

### 4. Multi-tool plugins (drops the 4-stub installer)

**Problem.** open-codex loads exactly one tool per file, so coding-chat needs
`scripts/install-codex.mjs` to generate four stub files. That is an artifact
of the format, not of the plugin's needs.

**Proposal.**
- Plugin-function shape already solves this: `tool:` is a map, register
  each entry (exactly like opencode's `Hooks.tool`).
- Optionally for the legacy shape: if the module default-exports
  `{ tools: [...] }` (array), register each.
- Acceptance: `node scripts/install-codex.mjs` reduces to a single
  `agentmesh.js` stub (or disappears entirely if npm-style resolution
  lands, see #6).

### 5. Notification channel (toasts for incoming messages)

**Problem.** When another agent sends a chat message, the human should see
it without asking. opencode surfaces this via TUI toasts; open-codex has no
plugin→UI channel (plugins can only react to their own handler being
called).

**Proposal.** Expose a tiny imperative API on the `PluginInput` shim of the
plugin-function shape:

```ts
input.notify(title, message)  // → routes to the ink UI (onItem or a toast component)
```

This is strictly additive; plugins that never call it pay nothing.
- Acceptance: incoming agentmesh messages pop in the open-codex TUI without
  the agent calling `agent_chat_history` first.

### 6. npm plugin resolution (optional, nice-to-have)

**Problem.** `~/.open-codex/plugins/` requires local files. coding-chat is an
npm package; users must clone it and run the installer.

**Proposal.** In the `plugins` config (see #1), also accept package
specifiers:

```jsonc
{ "plugins": { "agentmesh": { "spec": "agentmesh@^0.2", "options": {...} } } }
```

Resolve from npm into `~/.open-codex/packages/` at startup (opencode and
Kilo both do exactly this with Bun's auto-install; a plain
`npm install --prefix` is fine here). Only worth doing after #1–#4, since
the plugin-function shape determines what entrypoint to load
(`exports["."]` / `main`).

### 7. Minor fixes

- **`.ts` support**: accept `.ts` next to `.js` in the plugins dir when
  running on Node >= 23.6 (type-stripping is native). Low priority —
  agentmesh's stubs already work because Node imports `.ts` via `file://`
  when referenced from the stub, but the *stub itself* must be `.js`.
- **Project-local plugins**: scan `.open-codex/plugins/` in the project
  dir in addition to `~/.open-codex/plugins/` (matches opencode's
  project-scope plugins; also gives agentmesh a per-project room default
  from the project name — agentmesh's `resolveRoom` policy will not use it
  implicitly for security, but users can).
- **Handler args as parsed object**: pass `args` as the parsed object in
  addition to the JSON string (agentmesh tolerates the string fine; this
  is about future plugin authors writing `JSON.parse` in every handler).

---

## What coding-chat will do on its side once these land

Tracked in the coding-chat repo, for reference:

- After #1 + #2 + #3 + #4: delete `src/codex.ts` and
  `scripts/install-codex.mjs`; load `src/index.ts` (the opencode entry)
  on open-codex unchanged. One code path, three hosts.
- After #5: enable the toast path for open-codex (it is currently
  disabled because there is no channel).
- After #6: document `npm:`-style install for open-codex alongside
  `opencode.json` / `kilo.json`.

## Non-goals (recommended explicitly NOT to build)

- **Full opencode SDK client emulation** (`client.session.*`,
  `client.event.subscribe`, …) — a large facade; agentmesh deliberately
  uses none of it beyond `app.log`/`tui.showToast`, which #5's `notify`
  plus the existing `log()` cover.
- **Event bus for plugins** (`session.idle`, `message.updated`, …) — no
  consumer needs it yet; add when a real plugin does.
- **`tool.execute.before/after` intercept hooks** — powerful but a
  security-sensitive surface (mutating other tools' args); design it
  deliberately if ever needed, not as part of this effort.
