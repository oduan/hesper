# MVP2 Real Agent Runtime Architecture

## 1. Scope

This document describes the target runtime architecture for MVP2 of `hesper-desktop/`.
It focuses on the real Agent loop, provider/model registry, secure secret storage, tools, skills, roles, prompt assembly, and subagent child runs.

## 2. Architecture overview

MVP2 keeps the same high-level split as MVP1, but moves from a simple agent loop to a **registry-driven real agent runtime**. It **preserves** the MVP1 deterministic mock adapter, single-session skeleton, current `AgentRuntimeEvent` contract, and mock E2E paths; the real runtime is added as a switchable enhancement layer, not a replacement.

```mermaid
graph TD
    UI[Renderer UI / Settings UI] --> Core[app-core]
    Core --> ProviderReg[Provider Registry]
    Core --> ModelReg[Model Registry]
    Core --> ToolReg[Tool Registry]
    Core --> SkillReg[Skill Registry]
    Core --> RoleReg[Role Registry]
    Core --> Prompt[PromptAssemblyService]
    Core --> Secret[Secret Store]
    Core --> RT[agent-runtime]
    RT --> Pi[@earendil-works/pi-agent-core / pi-ai]
    Pi --> ProviderAPI[DeepSeek / OpenAI / OpenAI-compatible]
    Pi --> Executor[Tool Executors]
    Pi --> Child[agent.spawn-subagent]
    RT --> Store[(Persistence)]
    Core --> Store
```

## 3. Provider / model registry

### Provider registry

The provider registry is the source of truth for:

- provider id and display name
- provider type
- base URL
- auth strategy
- supported models
- connection status
- runtime capability flags

MVP2 providers:

- DeepSeek
- OpenAI / GPT
- custom OpenAI-compatible endpoint

### Model registry

The model registry is derived from provider metadata and normalized for UI/runtime use.
It must expose:

- model id
- provider id
- display name
- context length
- tool-call support
- streaming support
- suitability for main agent / subagent

## 4. Secret storage

API keys must be stored outside plain settings files.

### Hard security boundary

- renderer never receives raw API keys or reversible secret material
- prompt assembly never sees raw API keys
- IPC return values never include raw API keys
- logs, runtime events, traces, and test snapshots must not contain raw API keys or reversible secret material
- only the `main/app-core` credential vault path may resolve a provider client with plaintext key access, and that access must be transient, non-logged, and never forwarded into prompts or UI state

Preferred behavior:

- OS secure storage when available
- encrypted local fallback when necessary
- only status + reference stored in app settings

UI may show:

- connected
- disconnected
- re-auth required

UI must never render the full key.

## 5. Tools: definitions, executors, policy

MVP2 uses a three-layer tool model:

1. **ToolDefinition**: id, name, description, schema, category
2. **ToolExecutor**: actual execution implementation
3. **PermissionPolicy**: whether this run/role/subagent may call the tool

### Required rule

**PermissionPolicy → ToolExecutor → child run / tool result** is the only allowed order.

Permission policy must run before execution.

### Tool result handling

Tool calls must produce visible runtime events and persisted steps.
Tool failures must remain in the run history.

## 6. Skills registry and prompt injection

Skills are discoverable items that can be injected into prompts when enabled.

The skills registry must record:

- source: builtin / workspace / project
- content path or summary
- enabled state
- conflict/missing status

Prompt assembly must inject a structured summary of the selected skills, not a raw dump of all skill text.

## 7. Roles registry and prompt injection

Roles define execution boundaries.

A role should include:

- `roleId`
- name and description
- default model id
- allowed tool ids
- allowed skill ids
- can be main agent / subagent
- max depth / max count

Prompt assembly must clearly state the role boundary for both main agent and subagent prompts.

## 8. PromptAssemblyService

PromptAssemblyService is a central service used before every run and should be introduced behind a small interface boundary first, then split into provider/tool/role/subagent submodules as implementation grows.

### Inputs

- session context
- provider/model registry
- tool registry
- skill registry
- role registry
- permission policy
- subagent constraints
- current depth / parent run context

### Outputs

- main agent system prompt
- subagent system prompt
- tool list
- role instructions
- subagent usage rules

### Minimal interface sketches

```ts
type PromptAssemblyInput = {
  sessionId: string
  roleId: string
  modelId: string
  depth: number
  parentRunId?: string
  allowedToolIds: string[]
}

type PromptAssemblyOutput = {
  systemPrompt: string
  toolManifest: string
  subagentRules: string
}

type ProviderRegistry = {
  listProviders(): ProviderSummary[]
}

type CredentialVault = {
  resolveForClient(providerId: string): Promise<{ apiKey: string }>
}

type ToolRegistry = {
  listDefinitions(roleId?: string): ToolDefinition[]
}

type SubagentService = {
  spawn(input: { roleId: string; allowedToolIds: string[]; maxDepth: number; maxCount: number }): Promise<string>
}
```

### Prompt requirements

The prompt must explicitly state:

- which tools are available
- how to use each tool
- which tools are not allowed
- when to spawn a subagent
- how to assign `roleId`
- how to limit `allowedToolIds`
- how to obey `maxDepth` and `maxCount`

## 9. Real agent loop

MVP2 must use `@earendil-works/pi-agent-core` and `@earendil-works/pi-ai` for the real loop.

Hesper-owned responsibilities:

- build the prompt
- provide registry data
- map runtime events
- persist runs/steps/messages
- enforce permissions
- render UI state

Pi-owned responsibilities:

- model interaction
- streaming
- tool call orchestration
- child run execution semantics

## 10. Subagent child run

The main agent must call `agent.spawn-subagent` to create child runs.

A child run must be created with:

- `roleId`
- `allowedToolIds`
- `maxDepth`
- `maxCount`
- task description
- optional context summary

### Safety constraints

- child runs must not exceed role/tool limits
- recursion depth must be capped
- count limit must be enforced
- child run events must be linked back to parent run id

## 11. Settings UI split

### Compatibility / migration note

MVP2 settings split must remain compatible with MVP1 defaults and preserve the existing mock-path configuration so users can keep the deterministic baseline while enabling real provider paths incrementally.

Settings should be split into these modules:

- Provider & API Keys
- Model Registry
- Tools & Permissions
- Skills
- Roles
- Runtime / Agent Behavior
- Appearance

### Acceptance

- each module can be opened independently
- provider config does not leak API keys
- role/skill/tool scopes are visually distinct
- settings changes feed into prompt assembly
- session overrides are distinguishable from system defaults

## 12. Event flow

Runtime events remain the observable contract for the UI.

- `run.created`
- `run.started`
- `step.created`
- `step.updated`
- `message.delta`
- `message.completed`
- `run.retrying`
- `run.failed`
- `run.succeeded`

Child run events should extend this contract without breaking the existing surface.

## 13. Implementation note

`hesper-desktop/docs/architecture/runtime-events.md` describes the current runtime event baseline.
This document defines the MVP2 target architecture and should be read together with it.
