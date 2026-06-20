# Codex OAuth Connection Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-window Add Connection picker with Codex OAuth and Custom paths, then make Codex OAuth connections saveable, testable, and resolvable as Pi-backed Codex models.

**Architecture:** Keep the UI flow inside `ProviderSettingsPanel` using fixed overlays that start below the 36px titlebar. Extend provider metadata with Pi OAuth fields (`authType`, `piAuthProvider`) and store OAuth bearer material only through the credential vault. Add strict Electron IPC methods for starting OAuth, checking status, and saving the authorized Codex connection.

**Tech Stack:** React, TypeScript, Zod, Electron IPC, Vitest, React Testing Library, `@earendil-works/pi-ai` model resolution.

---

## File Structure

- Modify `hesper-desktop/packages/shared/src/domain.ts` — add Pi/OAuth provider metadata to shared provider types.
- Modify `hesper-desktop/packages/shared/src/schemas.ts` — validate new provider metadata.
- Modify `hesper-desktop/packages/shared/src/__tests__/schemas.test.ts` — prove schema accepts Codex OAuth provider records and rejects invalid OAuth provider names.
- Modify `hesper-desktop/apps/desktop/electron/ipc-contract.ts` — add OAuth IPC channels, schemas, DTOs, and `HesperDesktopApi.providers` methods.
- Modify `hesper-desktop/packages/app-core/src/model-provider-service.ts` — own OAuth session state, save Codex OAuth provider metadata, store OAuth tokens through credential vault, seed Codex models, and test OAuth providers without API probes.
- Modify `hesper-desktop/packages/app-core/src/__tests__/model-provider-service.test.ts` — service-level TDD for Codex OAuth lifecycle.
- Modify `hesper-desktop/packages/agent-runtime/src/model-resolver.ts` — resolve `pi` providers using `piAuthProvider`, and require credentials for OAuth providers through the same vault path.
- Modify `hesper-desktop/packages/agent-runtime/src/__tests__/model-resolver.test.ts` — verify Codex OAuth model resolution uses Pi `openai-codex` provider and reads no renderer-visible secrets.
- Modify `hesper-desktop/apps/desktop/electron/ipc-handlers.ts` — wire OAuth IPC, call `openExternal`, validate trusted auth URLs, and persist saved OAuth connection.
- Modify `hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts` — strict IPC and external-browser tests.
- Modify `hesper-desktop/apps/desktop/electron/preload.ts` — expose OAuth provider methods to renderer.
- Modify `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts` — add fallback/mock implementations for tests and Storybook-like local use.
- Modify `hesper-desktop/apps/desktop/renderer/src/provider-settings-panel.tsx` — add full-window picker, Codex authorization page, Custom transition, and existing API config overlay reuse.
- Modify `hesper-desktop/apps/desktop/renderer/tests/provider-settings.test.tsx` — renderer TDD for picker, Custom route, Codex authorization, save, and regressions.

## Task 1: Shared provider metadata and IPC contract

**Files:**
- Modify: `hesper-desktop/packages/shared/src/domain.ts`
- Modify: `hesper-desktop/packages/shared/src/schemas.ts`
- Modify: `hesper-desktop/packages/shared/src/__tests__/schemas.test.ts`
- Modify: `hesper-desktop/apps/desktop/electron/ipc-contract.ts`

- [ ] **Step 1: Write failing shared schema tests**

Append to `hesper-desktop/packages/shared/src/__tests__/schemas.test.ts`:

```ts
it('accepts Codex OAuth Pi provider metadata without an API endpoint', () => {
  const parsed = modelProviderConfigSchema.parse({
    id: 'chatgpt-codex',
    name: 'ChatGPT Codex',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    hasApiKey: true,
    enabled: true,
    defaultModelId: 'pi/gpt-5.5',
    createdAt: '2026-06-20T15:20:00.000Z',
    updatedAt: '2026-06-20T15:20:00.000Z'
  })

  expect(parsed).toMatchObject({
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    hasApiKey: true
  })
})

it('rejects unsupported Pi OAuth provider names', () => {
  expect(() => modelProviderConfigSchema.parse({
    id: 'bad-oauth',
    name: 'Bad OAuth',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'not-codex',
    enabled: true,
    createdAt: '2026-06-20T15:20:00.000Z',
    updatedAt: '2026-06-20T15:20:00.000Z'
  })).toThrow()
})
```

- [ ] **Step 2: Run shared tests and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/shared test -- schemas
```

Expected: fails because `kind: 'pi'`, `authType`, and `piAuthProvider` are not accepted.

- [ ] **Step 3: Implement shared provider metadata**

In `hesper-desktop/packages/shared/src/domain.ts`, change the provider types to:

```ts
export type ModelProviderKind = 'mock' | 'openai' | 'deepseek' | 'openai-compatible' | 'anthropic' | 'custom' | 'pi'
export type ModelProviderAuthType = 'api_key' | 'oauth' | 'none'
export type PiAuthProvider = 'openai-codex'

export type ModelProviderConfig = {
  id: string
  name: string
  kind: ModelProviderKind
  authType?: ModelProviderAuthType
  piAuthProvider?: PiAuthProvider
  baseUrl?: string
  apiKeyRef?: string
  hasApiKey?: boolean
  enabled: boolean
  defaultModelId?: string
  createdAt: string
  updatedAt: string
}
```

In `hesper-desktop/packages/shared/src/schemas.ts`, extend `modelProviderConfigBaseSchema`:

```ts
const modelProviderConfigBaseSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['mock', 'openai', 'deepseek', 'openai-compatible', 'anthropic', 'custom', 'pi']),
  authType: z.enum(['api_key', 'oauth', 'none']).optional(),
  piAuthProvider: z.enum(['openai-codex']).optional(),
  baseUrl: z.string().url().optional(),
  apiKeyRef: z.string().min(1).optional(),
  hasApiKey: z.boolean().optional(),
  enabled: z.boolean(),
  defaultModelId: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).superRefine((provider, ctx) => {
  if (provider.piAuthProvider && provider.kind !== 'pi') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['piAuthProvider'], message: 'piAuthProvider requires kind pi' })
  }
  if (provider.authType === 'oauth' && provider.piAuthProvider !== 'openai-codex') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['piAuthProvider'], message: 'Codex OAuth requires openai-codex' })
  }
})
```

- [ ] **Step 4: Add OAuth IPC schemas**

In `hesper-desktop/apps/desktop/electron/ipc-contract.ts` add channels:

```ts
providersStartOAuthAuthorization: 'providers:startOAuthAuthorization',
providersGetOAuthAuthorizationStatus: 'providers:getOAuthAuthorizationStatus',
providersSaveOAuthConnection: 'providers:saveOAuthConnection',
```

Add schemas and types near provider schemas:

```ts
export const piAuthProviderSchema = z.enum(['openai-codex'])
export const providerOAuthStatusSchema = z.enum(['pending', 'authorized', 'failed'])

export const providerOAuthStartInputSchema = z.object({
  provider: piAuthProviderSchema,
  connectionName: nonEmptyStringSchema
}).strict()

export const providerOAuthStartResultSchema = z.object({
  provider: piAuthProviderSchema,
  sessionId: nonEmptyStringSchema,
  authorizationUrl: z.string().url(),
  status: providerOAuthStatusSchema,
  message: z.string().min(1)
}).strict()

export const providerOAuthStatusInputSchema = z.object({
  sessionId: nonEmptyStringSchema
}).strict()

export const providerOAuthStatusResultSchema = z.object({
  provider: piAuthProviderSchema,
  sessionId: nonEmptyStringSchema,
  status: providerOAuthStatusSchema,
  message: z.string().min(1)
}).strict()

export const providerOAuthSaveInputSchema = z.object({
  sessionId: nonEmptyStringSchema,
  connectionName: nonEmptyStringSchema
}).strict()

export type ProviderOAuthStartInput = z.infer<typeof providerOAuthStartInputSchema>
export type ProviderOAuthStartResult = z.infer<typeof providerOAuthStartResultSchema>
export type ProviderOAuthStatusInput = z.infer<typeof providerOAuthStatusInputSchema>
export type ProviderOAuthStatusResult = z.infer<typeof providerOAuthStatusResultSchema>
export type ProviderOAuthSaveInput = z.infer<typeof providerOAuthSaveInputSchema>
```

Extend `HesperDesktopApi.providers`:

```ts
startOAuthAuthorization(input: ProviderOAuthStartInput): Promise<ProviderOAuthStartResult>
getOAuthAuthorizationStatus(input: ProviderOAuthStatusInput): Promise<ProviderOAuthStatusResult>
saveOAuthConnection(input: ProviderOAuthSaveInput): Promise<ModelProviderDto>
```

- [ ] **Step 5: Run shared and contract typecheck**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/shared test -- schemas
pnpm --filter @hesper/desktop typecheck
```

Expected: shared tests pass; desktop typecheck may still fail until renderer/preload implement new API methods.

- [ ] **Step 6: Commit Task 1**

```bash
git add hesper-desktop/packages/shared/src/domain.ts hesper-desktop/packages/shared/src/schemas.ts hesper-desktop/packages/shared/src/__tests__/schemas.test.ts hesper-desktop/apps/desktop/electron/ipc-contract.ts
git commit -m "feat: add Codex OAuth provider contract"
```

## Task 2: App-core Codex OAuth lifecycle

**Files:**
- Modify: `hesper-desktop/packages/app-core/src/model-provider-service.ts`
- Modify: `hesper-desktop/packages/app-core/src/__tests__/model-provider-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Append to `model-provider-service.test.ts`:

```ts
it('starts, authorizes, and saves a Codex OAuth provider without exposing tokens', async () => {
  const persistence = await createInMemoryPersistence()
  const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
  const oauthGateway = {
    startAuthorization: vi.fn(async () => ({
      sessionId: 'oauth-session-1',
      authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1'
    })),
    getAuthorizationStatus: vi.fn(async () => ({ status: 'authorized' as const, message: '授权成功' })),
    consumeAuthorization: vi.fn(async () => ({
      accessToken: 'codex-oauth-access-token',
      models: [
        { id: 'pi/gpt-5.5', modelName: 'gpt-5.5', displayName: 'GPT-5.5', capabilities: ['streaming', 'toolCalls', 'reasoning'] as const, contextWindow: 272000 },
        { id: 'pi/gpt-5.4-mini', modelName: 'gpt-5.4-mini', displayName: 'GPT-5.4 Mini', capabilities: ['streaming', 'toolCalls', 'reasoning'] as const, contextWindow: 272000 }
      ],
      defaultModelId: 'pi/gpt-5.5'
    }))
  }
  const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, oauthGateway })

  const started = await service.startOAuthAuthorization({ provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
  expect(started).toMatchObject({ provider: 'openai-codex', sessionId: 'oauth-session-1', status: 'pending' })

  await expect(service.getOAuthAuthorizationStatus({ sessionId: 'oauth-session-1' })).resolves.toMatchObject({ status: 'authorized' })
  const saved = await service.saveOAuthConnection({ sessionId: 'oauth-session-1', connectionName: 'ChatGPT Codex' })

  expect(saved).toMatchObject({
    id: 'chatgpt-codex',
    name: 'ChatGPT Codex',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    enabled: true,
    defaultModelId: 'pi/gpt-5.5',
    hasApiKey: true
  })
  expect((await service.listModels('chatgpt-codex')).map((model) => model.id)).toEqual(['pi/gpt-5.5', 'pi/gpt-5.4-mini'])
  expect(JSON.stringify(saved)).not.toContain('codex-oauth-access-token')
  expect(Buffer.from(exportDatabaseBytes(persistence)).toString('latin1')).not.toContain('codex-oauth-access-token')
})

it('tests Codex OAuth providers by credential status instead of chat completions probe', async () => {
  const persistence = await createInMemoryPersistence()
  const credentialVaultService = createCredentialVaultService({ persistence, codec: createMockCodec(), now: () => now })
  const fetchMock = vi.fn()
  const service = createModelProviderService({ persistence, credentialVaultService, now: () => now, fetch: fetchMock as unknown as typeof fetch })

  await service.saveProvider({ id: 'chatgpt-codex', name: 'ChatGPT Codex', kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: 'pi/gpt-5.5' })
  await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'needs_api_key', hasApiKey: false })

  await credentialVaultService.saveProviderApiKey({ providerId: 'chatgpt-codex', apiKey: 'codex-oauth-access-token' })
  await expect(service.testProviderConnection({ providerId: 'chatgpt-codex' })).resolves.toMatchObject({ status: 'ok', hasApiKey: true, message: 'Codex 授权可用' })
  expect(fetchMock).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run app-core tests and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/app-core test -- model-provider-service
```

Expected: fails because OAuth service methods and `pi` provider fields do not exist.

- [ ] **Step 3: Implement OAuth gateway types and service methods**

In `model-provider-service.ts`, add exported types:

```ts
export type PiAuthProvider = 'openai-codex'
export type ProviderOAuthStatus = 'pending' | 'authorized' | 'failed'

export type ProviderOAuthGateway = {
  startAuthorization(input: { provider: PiAuthProvider; connectionName: string }): Promise<{ sessionId: string; authorizationUrl: string }>
  getAuthorizationStatus(input: { sessionId: string }): Promise<{ status: ProviderOAuthStatus; message: string }>
  consumeAuthorization(input: { sessionId: string }): Promise<{
    accessToken: string
    models: Array<{ id: string; modelName: string; displayName: string; capabilities: ModelConfig['capabilities']; contextWindow?: number }>
    defaultModelId: string
  }>
}
```

Extend `SaveModelProviderInput` and `ModelProviderService`:

```ts
export type SaveModelProviderInput = {
  id: string
  name: string
  kind: ModelProviderKind
  authType?: ModelProviderConfig['authType']
  piAuthProvider?: ModelProviderConfig['piAuthProvider']
  baseUrl?: string
  enabled?: boolean
  defaultModelId?: string
}

export type ModelProviderService = {
  // existing methods
  startOAuthAuthorization(input: { provider: PiAuthProvider; connectionName: string }): Promise<{ provider: PiAuthProvider; sessionId: string; authorizationUrl: string; status: ProviderOAuthStatus; message: string }>
  getOAuthAuthorizationStatus(input: { sessionId: string }): Promise<{ provider: PiAuthProvider; sessionId: string; status: ProviderOAuthStatus; message: string }>
  saveOAuthConnection(input: { sessionId: string; connectionName: string }): Promise<ModelProviderConfig>
}
```

Inside `createModelProviderService`, use `options.oauthGateway` and an in-memory map:

```ts
const oauthGateway = options.oauthGateway
const oauthSessions = new Map<string, { provider: PiAuthProvider; connectionName: string }>()
```

Add service methods:

```ts
async startOAuthAuthorization(input) {
  if (!oauthGateway) throw new Error('Codex OAuth gateway is not configured')
  const started = await oauthGateway.startAuthorization(input)
  oauthSessions.set(started.sessionId, { provider: input.provider, connectionName: input.connectionName })
  return { provider: input.provider, sessionId: started.sessionId, authorizationUrl: started.authorizationUrl, status: 'pending', message: '等待浏览器授权' }
}

async getOAuthAuthorizationStatus(input) {
  const session = oauthSessions.get(input.sessionId)
  if (!session) return { provider: 'openai-codex', sessionId: input.sessionId, status: 'failed', message: '授权会话不存在' }
  const status = await oauthGateway!.getAuthorizationStatus(input)
  return { provider: session.provider, sessionId: input.sessionId, ...status }
}

async saveOAuthConnection(input) {
  const session = oauthSessions.get(input.sessionId)
  if (!session) throw new Error('授权会话不存在')
  const authorized = await oauthGateway!.getAuthorizationStatus({ sessionId: input.sessionId })
  if (authorized.status !== 'authorized') throw new Error(authorized.message)
  const consumed = await oauthGateway!.consumeAuthorization({ sessionId: input.sessionId })
  const provider = await this.saveProvider({ id: 'chatgpt-codex', name: input.connectionName.trim(), kind: 'pi', authType: 'oauth', piAuthProvider: 'openai-codex', enabled: true, defaultModelId: consumed.defaultModelId })
  await options.credentialVaultService.saveProviderApiKey({ providerId: provider.id, apiKey: consumed.accessToken })
  for (const model of consumed.models) {
    await this.saveModel({ providerId: provider.id, enabled: true, ...model })
  }
  oauthSessions.delete(input.sessionId)
  return (await this.getProvider(provider.id))!
}
```

If `this` binding is inconvenient inside the object literal, implement local helper functions `saveProviderRecord` and `saveModelRecord`, then call them from both existing methods and `saveOAuthConnection`.

- [ ] **Step 4: Update provider merge and connection test**

In `mergeProvider`, carry new metadata:

```ts
...(input.authType !== undefined ? { authType: input.authType } : existing?.authType !== undefined ? { authType: existing.authType } : {}),
...(input.piAuthProvider !== undefined ? { piAuthProvider: input.piAuthProvider } : existing?.piAuthProvider !== undefined ? { piAuthProvider: existing.piAuthProvider } : {}),
```

In `testProviderConnection`, before HTTP probing:

```ts
if (provider.kind === 'pi' && provider.authType === 'oauth' && provider.piAuthProvider === 'openai-codex') {
  return credentialStatus.hasApiKey
    ? { providerId: provider.id, status: 'ok', hasApiKey: true, message: 'Codex 授权可用' }
    : { providerId: provider.id, status: 'needs_api_key', hasApiKey: false, message: 'Codex 授权未完成' }
}
```

- [ ] **Step 5: Run app-core tests and verify GREEN**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/app-core test -- model-provider-service
```

Expected: all model-provider-service tests pass.

- [ ] **Step 6: Commit Task 2**

```bash
git add hesper-desktop/packages/app-core/src/model-provider-service.ts hesper-desktop/packages/app-core/src/__tests__/model-provider-service.test.ts
git commit -m "feat: support Codex OAuth provider lifecycle"
```

## Task 3: Electron IPC, trusted external browser launch, preload, and renderer API client

**Files:**
- Modify: `hesper-desktop/apps/desktop/electron/ipc-handlers.ts`
- Modify: `hesper-desktop/apps/desktop/electron/main.ts`
- Modify: `hesper-desktop/apps/desktop/electron/preload.ts`
- Modify: `hesper-desktop/apps/desktop/renderer/src/ipc-client.ts`
- Modify: `hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts`

- [ ] **Step 1: Write failing IPC tests**

Append to `ipc-handlers.test.ts`:

```ts
it('starts Codex OAuth through strict IPC and opens only trusted authorization URLs', async () => {
  const persistence = await createInMemoryPersistence()
  const credentialCodec = createMockCredentialCodec()
  const container = createServiceContainer({ persistence, agentMode: 'mock', credentialCodec })
  const oauthGateway = {
    startAuthorization: vi.fn(async () => ({ sessionId: 'oauth-session-1', authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1' })),
    getAuthorizationStatus: vi.fn(async () => ({ status: 'pending' as const, message: '等待浏览器授权' })),
    consumeAuthorization: vi.fn()
  }
  ;(container.modelProviderService as any).oauthGateway = oauthGateway
  const openExternal = vi.fn(async () => undefined)
  const handles = new Map<string, (event: any, ...args: any[]) => Promise<unknown> | unknown>()
  const ipcMain = { handle: vi.fn((channel: string, handler: any) => handles.set(channel, handler)), removeHandler: vi.fn() }
  const dialog = { showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['C:/workspace'] })) }

  registerIpcHandlers({ ipcMain, dialog, container, openExternal })

  const started = await handles.get(ipcChannels.providersStartOAuthAuthorization)?.({ sender: { id: 1 } }, { provider: 'openai-codex', connectionName: 'ChatGPT Codex' })
  expect(started).toMatchObject({ provider: 'openai-codex', sessionId: 'oauth-session-1', status: 'pending' })
  expect(openExternal).toHaveBeenCalledWith('https://auth.craft.do/oauth/openai-codex?state=oauth-session-1')

  await expect(handles.get(ipcChannels.providersStartOAuthAuthorization)?.({ sender: { id: 1 } }, { provider: 'github-copilot', connectionName: 'GitHub Copilot' })).rejects.toThrow()
})
```

- [ ] **Step 2: Run IPC tests and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- ipc-handlers
```

Expected: fails because OAuth channels and `openExternal` injection are missing.

- [ ] **Step 3: Wire handler dependencies**

In `ipc-handlers.ts`, import schemas from the contract and extend options:

```ts
export type RegisterIpcHandlersOptions = {
  ipcMain: Pick<IpcMain, 'handle' | 'removeHandler'>
  dialog: Pick<Dialog, 'showOpenDialog'>
  container: ServiceContainer
  openExternal?: (url: string) => Promise<void>
  savePersistence?: () => Promise<void>
  schedulePersistenceSave?: () => void
  getWindowForEvent?: (event: IpcMainInvokeEvent) => WindowControlTarget | undefined
}
```

Add helper:

```ts
function assertTrustedOAuthUrl(url: string): string {
  const parsed = new URL(url)
  const allowedHosts = new Set(['auth.craft.do', 'agents.craft.do', 'chatgpt.com', 'auth.openai.com'])
  if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) {
    throw new Error('Untrusted OAuth authorization URL')
  }
  return parsed.toString()
}
```

Add handlers:

```ts
[ipcChannels.providersStartOAuthAuthorization]: async (_event, payload) => {
  const input = providerOAuthStartInputSchema.parse(payload)
  const result = await options.container.modelProviderService.startOAuthAuthorization(input)
  const trustedUrl = assertTrustedOAuthUrl(result.authorizationUrl)
  await options.openExternal?.(trustedUrl)
  return providerOAuthStartResultSchema.parse(result)
},
[ipcChannels.providersGetOAuthAuthorizationStatus]: async (_event, payload) => {
  const result = await options.container.modelProviderService.getOAuthAuthorizationStatus(providerOAuthStatusInputSchema.parse(payload))
  return providerOAuthStatusResultSchema.parse(result)
},
[ipcChannels.providersSaveOAuthConnection]: async (_event, payload) => {
  const provider = await options.container.modelProviderService.saveOAuthConnection(providerOAuthSaveInputSchema.parse(payload))
  await savePersistence()
  return modelProviderConfigSchema.parse(provider)
},
```

Include `providersSaveOAuthConnection` in `mutatingChannels`.

In `main.ts`, import `shell` from Electron and pass:

```ts
disposeIpcHandlers = registerIpcHandlers({ ipcMain, dialog, container, savePersistence, schedulePersistenceSave, openExternal: (url) => shell.openExternal(url) })
```

- [ ] **Step 4: Expose renderer APIs**

In `preload.ts`, extend `providers`:

```ts
startOAuthAuthorization: (input) => ipcRenderer.invoke(ipcChannels.providersStartOAuthAuthorization, input),
getOAuthAuthorizationStatus: (input) => ipcRenderer.invoke(ipcChannels.providersGetOAuthAuthorizationStatus, input),
saveOAuthConnection: (input) => ipcRenderer.invoke(ipcChannels.providersSaveOAuthConnection, input),
```

In `renderer/src/ipc-client.ts`, extend both the real `window.hesper` type usage and fallback implementation with methods that reject clearly:

```ts
startOAuthAuthorization: async () => { throw new Error('Codex OAuth is only available in the desktop shell') },
getOAuthAuthorizationStatus: async () => ({ provider: 'openai-codex', sessionId: 'local', status: 'failed', message: 'Codex OAuth is only available in the desktop shell' }),
saveOAuthConnection: async () => { throw new Error('Codex OAuth is only available in the desktop shell') },
```

- [ ] **Step 5: Run IPC tests and typecheck**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- ipc-handlers
pnpm --filter @hesper/desktop typecheck
```

Expected: IPC tests pass; typecheck passes after service container exposes methods.

- [ ] **Step 6: Commit Task 3**

```bash
git add hesper-desktop/apps/desktop/electron/ipc-handlers.ts hesper-desktop/apps/desktop/electron/main.ts hesper-desktop/apps/desktop/electron/preload.ts hesper-desktop/apps/desktop/renderer/src/ipc-client.ts hesper-desktop/apps/desktop/tests/ipc-handlers.test.ts
git commit -m "feat: wire Codex OAuth desktop IPC"
```

## Task 4: Model resolver support for Pi Codex OAuth

**Files:**
- Modify: `hesper-desktop/packages/agent-runtime/src/model-resolver.ts`
- Modify: `hesper-desktop/packages/agent-runtime/src/__tests__/model-resolver.test.ts`

- [ ] **Step 1: Write failing resolver test**

Append to `model-resolver.test.ts`:

```ts
it('resolves Codex OAuth Pi models through openai-codex credentials', async () => {
  const readProviderApiKey = vi.fn(async () => 'codex-oauth-access-token')
  const getPiModel = vi.fn(() => piModel({ id: 'gpt-5.5', name: 'GPT-5.5', provider: 'openai-codex', reasoning: true }))
  const codexProvider = provider({
    id: 'chatgpt-codex',
    name: 'ChatGPT Codex',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    defaultModelId: 'pi/gpt-5.5'
  })
  const codexModel = model({
    id: 'pi/gpt-5.5',
    providerId: 'chatgpt-codex',
    modelName: 'gpt-5.5',
    displayName: 'GPT-5.5',
    capabilities: ['streaming', 'toolCalls', 'reasoning'],
    contextWindow: 272000
  })
  const resolver = createRegistryModelResolver({
    registry: registry({ providers: [codexProvider], models: [codexModel] }),
    readProviderApiKey,
    getPiModel
  })

  const resolved = await resolver.resolve({ modelId: 'pi/gpt-5.5' })

  expect(getPiModel).toHaveBeenCalledWith('openai-codex' as never, 'gpt-5.5')
  expect(resolved.model).toEqual(expect.objectContaining({ id: 'gpt-5.5', provider: 'chatgpt-codex', reasoning: true }))
  await expect(resolved.getApiKey?.('openai-codex')).resolves.toBe('codex-oauth-access-token')
  await expect(resolved.getApiKey?.('chatgpt-codex')).resolves.toBe('codex-oauth-access-token')
  expect(resolved.getApiKey?.('openai')).toBeUndefined()
})
```

- [ ] **Step 2: Run resolver tests and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/agent-runtime test -- model-resolver
```

Expected: fails because `pi` provider kind is unsupported.

- [ ] **Step 3: Implement Pi provider resolver branch**

In `model-resolver.ts`, add helper:

```ts
function piKnownProvider(provider: ModelProviderConfig): KnownProvider | undefined {
  return provider.kind === 'pi' ? provider.piAuthProvider as KnownProvider | undefined : knownProviderByKind[provider.kind]
}
```

Update `assertProviderKey`:

```ts
if (provider.kind === 'mock') return
const apiKey = await options.readProviderApiKey(provider.id)
if (!apiKey) {
  throw new Error(provider.authType === 'oauth'
    ? `Model provider needs OAuth authorization: ${provider.id}`
    : `Model provider needs an API key: ${provider.id}`)
}
```

Update `createModelForProvider`:

```ts
if (provider.kind === 'pi') {
  const knownProvider = piKnownProvider(provider)
  if (!knownProvider) throw new Error(`Unsupported Pi auth provider: ${provider.piAuthProvider ?? 'missing'}`)
  return mergeRegistryModel(getPiModel(knownProvider, model.modelName), provider, model)
}
```

Update aliases:

```ts
const apiKeyProviderAliases = new Set([
  provider.id,
  provider.kind,
  ...(provider.piAuthProvider ? [provider.piAuthProvider] : []),
  ...(provider.kind === 'openai-compatible' || provider.kind === 'custom' ? ['openai'] : [])
])
```

- [ ] **Step 4: Run resolver tests and verify GREEN**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/agent-runtime test -- model-resolver
```

Expected: all model-resolver tests pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add hesper-desktop/packages/agent-runtime/src/model-resolver.ts hesper-desktop/packages/agent-runtime/src/__tests__/model-resolver.test.ts
git commit -m "feat: resolve Codex OAuth Pi models"
```

## Task 5: Full-window Add Connection picker and Custom route

**Files:**
- Modify: `hesper-desktop/apps/desktop/renderer/src/provider-settings-panel.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/tests/provider-settings.test.tsx`

- [ ] **Step 1: Write failing picker tests**

Append to `provider-settings.test.tsx`:

```ts
it('opens a full-window add connection picker before showing Custom API configuration', async () => {
  const user = userEvent.setup()
  render(<App />)

  await user.click(await screen.findByRole('button', { name: '设置' }))
  await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))

  const picker = await screen.findByRole('dialog', { name: 'Add connection' })
  expect(picker).toBeInTheDocument()
  expect(picker).toHaveStyle({ position: 'fixed', top: '36px', left: '0px', right: '0px', bottom: '0px' })
  expect(screen.getByRole('button', { name: 'Codex 授权' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Custom' })).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'API 配置' })).not.toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Custom' }))
  expect(await screen.findByRole('dialog', { name: 'API 配置' })).toHaveStyle({ position: 'fixed', top: '36px' })
})
```

- [ ] **Step 2: Run renderer test and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- provider-settings
```

Expected: fails because clicking `+ 添加连接` opens API config directly.

- [ ] **Step 3: Add flow state and picker component**

In `provider-settings-panel.tsx`, add state:

```ts
type AddConnectionFlow = 'picker' | 'custom' | 'codex'
const [addConnectionFlow, setAddConnectionFlow] = useState<AddConnectionFlow>()
```

Change `openAddConnection`:

```ts
const openAddConnection = () => {
  setError(undefined)
  setMessage(undefined)
  setConnectionResult(undefined)
  setOpenMenuProviderId(undefined)
  setDialogState(undefined)
  setAddConnectionFlow('picker')
}
```

Add Custom launcher:

```ts
const openCustomConnection = () => {
  setAddConnectionFlow('custom')
  setDialogState({ mode: 'add', form: createConnectionForm() })
}
```

Add picker render:

```tsx
function ConnectionTypePicker({ onBack, onCustom, onCodex }: { onBack: () => void; onCustom: () => void; onCodex: () => void }) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Add connection" style={fullWindowOverlayStyle}>
      <button type="button" aria-label="关闭添加连接" onClick={onBack} style={overlayCloseStyle}>×</button>
      <div style={connectionPickerPanelStyle}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Add connection</h2>
          <p style={{ margin: '12px 0 0', color: mutedTextColor }}>选择一种连接方式。</p>
        </header>
        <div style={connectionPickerGridStyle}>
          <button type="button" onClick={onCodex} style={connectionChoiceCardStyle}>
            <strong>Codex 授权</strong>
            <span>使用 ChatGPT Codex 授权访问 Codex 相关模型。</span>
          </button>
          <button type="button" onClick={onCustom} style={connectionChoiceCardStyle}>
            <strong>Custom</strong>
            <span>手动配置 Endpoint、API key 和模型。</span>
          </button>
        </div>
        <footer style={{ marginTop: 22 }}><button type="button" onClick={onBack} style={secondaryActionStyle}>Back</button></footer>
      </div>
    </div>
  )
}
```

Define shared style:

```ts
const fullWindowOverlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 1000,
  display: 'grid',
  placeItems: 'center',
  background: surfaceColor,
  padding: 24,
  overflow: 'auto'
}
```

Make `ConnectionDialog` use `fullWindowOverlayStyle` instead of the old overlay style.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- provider-settings
```

Expected: picker test and existing Custom tests pass.

- [ ] **Step 5: Commit Task 5**

```bash
git add hesper-desktop/apps/desktop/renderer/src/provider-settings-panel.tsx hesper-desktop/apps/desktop/renderer/tests/provider-settings.test.tsx
git commit -m "feat: add connection type picker"
```

## Task 6: Renderer Codex authorization page

**Files:**
- Modify: `hesper-desktop/apps/desktop/renderer/src/provider-settings-panel.tsx`
- Modify: `hesper-desktop/apps/desktop/renderer/tests/provider-settings.test.tsx`

- [ ] **Step 1: Extend renderer mocks and write failing Codex UI test**

In `provider-settings.test.tsx`, hoist OAuth mocks:

```ts
const startOAuthAuthorization = vi.fn()
const getOAuthAuthorizationStatus = vi.fn()
const saveOAuthConnection = vi.fn()
```

Add them to `hesperApi.providers` mock.

Append test:

```ts
it('authorizes and saves a Codex OAuth connection from the full-window flow', async () => {
  const user = userEvent.setup()
  startOAuthAuthorization.mockResolvedValueOnce({
    provider: 'openai-codex',
    sessionId: 'oauth-session-1',
    authorizationUrl: 'https://auth.craft.do/oauth/openai-codex?state=oauth-session-1',
    status: 'pending',
    message: '等待浏览器授权'
  })
  getOAuthAuthorizationStatus.mockResolvedValueOnce({ provider: 'openai-codex', sessionId: 'oauth-session-1', status: 'authorized', message: '授权成功' })
  saveOAuthConnection.mockResolvedValueOnce({
    id: 'chatgpt-codex',
    name: 'My Codex',
    kind: 'pi',
    authType: 'oauth',
    piAuthProvider: 'openai-codex',
    enabled: true,
    defaultModelId: 'pi/gpt-5.5',
    hasApiKey: true,
    createdAt: now,
    updatedAt: now
  })
  render(<App />)

  await user.click(await screen.findByRole('button', { name: '设置' }))
  await user.click(await screen.findByRole('button', { name: '+ 添加连接' }))
  await user.click(await screen.findByRole('button', { name: 'Codex 授权' }))

  expect(await screen.findByRole('dialog', { name: 'Codex 授权' })).toBeInTheDocument()
  const nameInput = screen.getByLabelText('Codex 连接名称')
  expect(nameInput).toHaveValue('ChatGPT Codex')
  await user.clear(nameInput)
  await user.type(nameInput, 'My Codex')

  await user.click(screen.getByRole('button', { name: 'Open Browser' }))
  await waitFor(() => expect(startOAuthAuthorization).toHaveBeenCalledWith({ provider: 'openai-codex', connectionName: 'My Codex' }))
  expect(await screen.findByRole('status')).toHaveTextContent('等待浏览器授权')

  await user.click(screen.getByRole('button', { name: 'Check Status' }))
  expect(await screen.findByRole('status')).toHaveTextContent('授权成功')

  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(saveOAuthConnection).toHaveBeenCalledWith({ sessionId: 'oauth-session-1', connectionName: 'My Codex' }))
  expect(await screen.findByRole('status')).toHaveTextContent('已添加连接：My Codex')
})
```

- [ ] **Step 2: Run renderer test and verify RED**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- provider-settings
```

Expected: fails because Codex page does not exist.

- [ ] **Step 3: Implement Codex page state and actions**

In `provider-settings-panel.tsx`, add:

```ts
type CodexOAuthState = {
  connectionName: string
  sessionId?: string
  status: 'idle' | 'pending' | 'authorized' | 'failed'
  message?: string
}
const [codexOAuthState, setCodexOAuthState] = useState<CodexOAuthState>({ connectionName: 'ChatGPT Codex', status: 'idle' })
```

Add actions:

```ts
const openCodexConnection = () => {
  setError(undefined)
  setMessage(undefined)
  setCodexOAuthState({ connectionName: 'ChatGPT Codex', status: 'idle' })
  setAddConnectionFlow('codex')
}

const startCodexOAuth = async () => {
  const connectionName = codexOAuthState.connectionName.trim() || 'ChatGPT Codex'
  setError(undefined)
  const result = await hesperApi.providers.startOAuthAuthorization({ provider: 'openai-codex', connectionName })
  setCodexOAuthState({ connectionName, sessionId: result.sessionId, status: result.status, message: result.message })
}

const checkCodexOAuthStatus = async () => {
  if (!codexOAuthState.sessionId) return
  const result = await hesperApi.providers.getOAuthAuthorizationStatus({ sessionId: codexOAuthState.sessionId })
  setCodexOAuthState((current) => ({ ...current, status: result.status, message: result.message }))
}

const saveCodexOAuthConnection = async () => {
  if (!codexOAuthState.sessionId) return
  const provider = await hesperApi.providers.saveOAuthConnection({ sessionId: codexOAuthState.sessionId, connectionName: codexOAuthState.connectionName.trim() || 'ChatGPT Codex' })
  setAddConnectionFlow(undefined)
  setCodexOAuthState({ connectionName: 'ChatGPT Codex', status: 'idle' })
  setMessage(`已添加连接：${provider.name}`)
  await loadProviderSettings()
  await onModelRegistryChanged?.()
}
```

Add component:

```tsx
function CodexAuthorizationPage({ state, updateName, onBack, onOpenBrowser, onCheckStatus, onSave }: {
  state: CodexOAuthState
  updateName: (name: string) => void
  onBack: () => void
  onOpenBrowser: () => void
  onCheckStatus: () => void
  onSave: () => void
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="Codex 授权" style={fullWindowOverlayStyle}>
      <div style={overlayFormStyle}>
        <header style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Codex 授权</h2>
          <p style={{ margin: '12px 0 0', color: mutedTextColor }}>使用默认浏览器完成 ChatGPT Codex 授权。</p>
        </header>
        <label style={fieldStyle}>Connection Name
          <input aria-label="Codex 连接名称" value={state.connectionName} onChange={(event) => updateName(event.target.value)} style={inputStyle} />
        </label>
        {state.message ? <p role={state.status === 'failed' ? 'alert' : 'status'} style={state.status === 'failed' ? errorTextStyle : statusTextStyle}>{state.message}</p> : null}
        <footer style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10, marginTop: 22 }}>
          <button type="button" onClick={onBack} style={secondaryActionStyle}>Back</button>
          <button type="button" onClick={onOpenBrowser} style={secondaryActionStyle}>Open Browser</button>
          <button type="button" onClick={onCheckStatus} disabled={!state.sessionId} style={secondaryActionStyle}>Check Status</button>
          <button type="button" onClick={onSave} disabled={state.status !== 'authorized'} style={primaryActionStyle}>Save</button>
        </footer>
      </div>
    </div>
  )
}
```

Render it when `addConnectionFlow === 'codex'`.

- [ ] **Step 4: Run renderer tests and verify GREEN**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/desktop test -- provider-settings
```

Expected: Codex UI test and existing provider settings tests pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add hesper-desktop/apps/desktop/renderer/src/provider-settings-panel.tsx hesper-desktop/apps/desktop/renderer/tests/provider-settings.test.tsx
git commit -m "feat: add Codex authorization flow UI"
```

## Task 7: Integration verification

**Files:**
- No source edits unless verification reveals a failing assertion.

- [ ] **Step 1: Run focused test suites**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/shared test -- schemas
pnpm --filter @hesper/app-core test -- model-provider-service
pnpm --filter @hesper/agent-runtime test -- model-resolver
pnpm --filter @hesper/desktop test -- ipc-handlers
pnpm --filter @hesper/desktop test -- provider-settings
```

Expected: every command exits 0.

- [ ] **Step 2: Run package typechecks**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm --filter @hesper/shared typecheck
pnpm --filter @hesper/app-core typecheck
pnpm --filter @hesper/agent-runtime typecheck
pnpm --filter @hesper/desktop typecheck
```

Expected: every command exits 0.

- [ ] **Step 3: Run full workspace check**

Run:

```bash
cd C:/Users/oisin/dev/hesper/hesper-desktop
pnpm check
```

Expected: exits 0 with no failing tests, lint errors, or TypeScript errors.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git -C C:/Users/oisin/dev/hesper status --short
git -C C:/Users/oisin/dev/hesper log --oneline -8
git -C C:/Users/oisin/dev/hesper diff --stat HEAD~6..HEAD
```

Expected: only planned source/test files changed across the implementation commits.

- [ ] **Step 5: Final commit if verification fixes were needed**

If Step 1-3 required small verification fixes, commit them:

```bash
git add hesper-desktop
git commit -m "fix: stabilize Codex OAuth connection flow"
```

If no fixes were needed, do not create an empty commit.

## Self-Review

- Spec coverage: picker, Codex-only OAuth entry, Custom route, full-window coverage below titlebar, default browser launch, saveable connection, validation, and verification are each mapped to tasks.
- No unfilled sections remain.
- Type consistency: `provider: 'openai-codex'`, `kind: 'pi'`, `authType: 'oauth'`, and `piAuthProvider: 'openai-codex'` are used consistently across shared schema, app-core, IPC, renderer, and resolver.
- Security boundary: OAuth access token is only stored through credential vault and is never returned to renderer.
