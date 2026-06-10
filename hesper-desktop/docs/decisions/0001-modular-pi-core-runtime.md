# 0001 Modular pi core runtime

## Status

Accepted for MVP1.

## Context

hesper desktop needs a small but extensible agent runtime foundation. The MVP must support a deterministic local development path, queueing, persistence and retry handling without forcing Electron or renderer code to understand pi core internals.

## Decision

hesper uses `@earendil-works/pi-agent-core` as the agent runtime foundation.

Electron, app-core and UI do not call pi core directly. They communicate through `@hesper/agent-runtime`, which maps pi events into hesper runtime events and handles queueing, persistence and retry policy.

For local development and stable tests, the desktop shell defaults to the deterministic mock adapter unless `HESPER_AGENT_MODE=pi-core` is set.

## Consequences

- MVP1 keeps a single runtime abstraction for mock and pi-core execution.
- Renderer code only reacts to `AgentRuntimeEvent` records over IPC.
- Queueing, retries and message persistence stay outside Electron window code.
- Future skills, roles, tools and subagent support can extend `@hesper/agent-runtime` without rewriting the UI shell.
