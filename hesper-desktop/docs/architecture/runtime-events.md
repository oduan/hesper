# Runtime Events

hesper renderer subscribes to `AgentRuntimeEvent` records instead of waiting on long-running function calls.

## Event rules

- `run.created` stores the queued run record before execution starts.
- `run.started` marks the active run in the FIFO queue.
- `message.delta` is temporary streaming state and must not be treated as final history.
- `message.completed` is the only event that creates the final assistant message.
- `step.created` and `step.updated` drive the visible run step timeline.
- `run.retrying` is visible in the UI and persisted with retry metadata.
- `run.failed` preserves the failed run and enables retry by creating a new run.
- `run.succeeded` closes the active run after final message persistence.

## Current event surface

`@hesper/shared` exports the following runtime events:

- `run.created`
- `run.started`
- `step.created`
- `step.updated`
- `message.delta`
- `message.completed`
- `run.retrying`
- `run.failed`
- `run.succeeded`

This event contract keeps Electron IPC and renderer state updates small while leaving room for future child-run, skill and richer tool event expansion.
