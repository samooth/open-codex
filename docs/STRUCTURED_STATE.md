# Structured State Management (SSM) Protocol

OpenCodex uses a Structured State Management protocol to maintain context, focus, and architectural integrity across long-running autonomous sessions. This protocol is inspired by high-end agentic workflows.

## The Core Components

The agent maintains a mental model encapsulated in a `<state_snapshot>` block, usually output within its internal reasoning (`<thought>` tags).

| Tag | Purpose |
| :--- | :--- |
| `<overall_goal>` | The primary objective of the current session. |
| `<active_constraints>` | Technical or stylistic rules the agent must adhere to (e.g., "No external libs"). |
| `<key_knowledge>` | Critical discoveries made about the codebase during the session. |
| `<artifact_trail>` | A list of files modified or created during this specific mission. |
| `<task_state>` | A high-level breakdown of tasks marked as `[DONE]`, `[IN_PROGRESS]`, or `[TODO]`. |

## Implementation Strategy

### 1. Protocol Injection
The system prompt is updated to include the **SSM Protocol** instructions. The agent is taught to re-evaluate and output its state snapshot whenever it begins a complex task.

### 2. State Extraction (AgentLoop)
The `AgentLoop` intercepts these XML tags from the assistant's stream. 
- **Volatile State:** Extracted during reasoning and stored in memory.
- **Persistent State:** Saved to the session rollout to ensure continuity after a restart or clear.

### 3. Automatic Feedback Loop
In every turn, the *last known* state snapshot is automatically injected back into the system prompt. This prevents "context drift" where the agent forgets its original constraints or previously made discoveries.

## Example Output
```xml
<thought>
I need to refactor the authentication logic.
<state_snapshot>
  <overall_goal>Migrate from JWT to Session cookies</overall_goal>
  <active_constraints>
    - Do not modify the database schema
    - Use the existing Express middleware pattern
  </active_constraints>
  <key_knowledge>
    - The `auth.ts` file currently handles token signing in the `login` function.
  </key_knowledge>
  <task_state>
    - [DONE] Audit current JWT implementation
    - [IN_PROGRESS] Create session store utility
    - [TODO] Update login route
  </task_state>
</state_snapshot>
</thought>
```

## Mental Model Persistence
The `AgentLoop` maintains a `stateSnapshot` object that is updated every time the assistant outputs a `<state_snapshot>` block. This state includes:
- **Goals:** The current high-level objective.
- **Constraints:** Technical or stylistic rules.
- **Knowledge:** Facts discovered during the session.
- **Artifacts:** Files modified or created.
- **Tasks:** Synchronized with the UI roadmap (`TaskChecklist`).

## Unified Prompt Queue & Editing
To support thoughtful autonomous sessions, OpenCodex merges multiple user instructions sent while the agent is busy into a single pending mission update. 
- **Automatic Merging:** All messages sent while the agent is "loading" are concatenated.
- **Recall & Edit:** If the input field is empty, pressing **Up Arrow** will "pop" the entire merged queue back into the input field for review or modification.
