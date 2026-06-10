# hesper desktop

MVP1 desktop client for hesper.

- Electron shell
- React renderer
- `@hesper/app-core` application services
- `@hesper/agent-runtime` queueing, retry and persistence bridge
- `@earendil-works/pi-agent-core` backed runtime adapter
- local-first persistence
- high-density native-like UI

## Development

```bash
pnpm install
pnpm check
pnpm dev
pnpm --filter @hesper/desktop build
pnpm --filter @hesper/desktop smoke
pnpm --filter @hesper/desktop e2e
pnpm --filter @hesper/desktop verify-dev-runtime
```

### Command notes

- `pnpm check`: runs workspace typecheck and vitest suites.
- `pnpm dev`: starts the renderer dev server, Electron TypeScript watch build and preload copy watcher.
- `pnpm --filter @hesper/desktop build`: builds renderer and Electron outputs, patches ESM imports and verifies production entrypoints.
- `pnpm --filter @hesper/desktop smoke`: launches the packaged desktop shell against the built output for a fast UI sanity check.
- `pnpm --filter @hesper/desktop e2e`: runs Playwright desktop coverage against the built Electron app.
- `pnpm --filter @hesper/desktop verify-dev-runtime`: validates the Electron main/preload dev-runtime contract without starting the renderer dev server.

## Agent runtime

By default local development uses the deterministic mock adapter. To use pi core:

```bash
HESPER_AGENT_MODE=pi-core pnpm dev
```

The runtime adapter uses `@earendil-works/pi-agent-core` and maps stream/tool progress into hesper `AgentRuntimeEvent` records that drive the renderer timeline, retries and final message persistence.

See also:

- `docs/architecture/runtime-events.md`
- `docs/decisions/0001-modular-pi-core-runtime.md`

## MVP1 scope and limitations

- MVP1 implements a single-session desktop runtime loop with queueing, retry visibility and markdown/html output support.
- Skills, roles, tools and subagents are modeled for future expansion, but their UX remains intentionally minimal in this milestone.
- Local development and automated coverage default to the mock adapter so tests do not require external API credentials.

## Follow-up suggestions

- Expand runtime event coverage for richer tool payloads and future child-run/subagent events.
- Add stronger smoke assertions around window boot timing and initial session creation.
- Document production packaging, signing and distribution steps after MVP1 stabilizes.
