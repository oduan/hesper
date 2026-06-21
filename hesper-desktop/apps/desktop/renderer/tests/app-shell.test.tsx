// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, clearSessionSendError, pruneSessionSendErrors } from '../src/App'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

const { listSessions, createSession, updateTitle, deleteSession, generateTitle, markViewed, listRoles, createRole, updateRole, deleteRole, listMessages, listMessagesByRun, listRuns, listSteps, listWorkerInvocationsByParentRun, enqueue, stopRun, onEvent, getSettings, updateSettings, listProviders, listModels, listTools, setToolEnabled, toolCredentialStatus, saveToolApiKey, deleteToolApiKey, sshKeysList, sshKeysCreate, sshKeysDelete, sshServersList, sshServersCreate, sshServersUpdate, sshServersDelete, minimizeWindow, toggleMaximizeWindow, closeWindow } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'session-1',
    title: 'New chat',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  })),
  updateTitle: vi.fn(async (input: { id: string; title: string }) => ({
    id: input.id,
    title: input.title,
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:12.000Z'
  })),
  deleteSession: vi.fn(async (id: string) => ({
    id,
    title: 'Deleted chat',
    status: 'deleted',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:12.000Z'
  })),
  generateTitle: vi.fn(async (input: { id: string; modelId: string; userPrompt: string }) => ({
    id: input.id,
    title: '模型生成标题',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:12.000Z'
  })),
  markViewed: vi.fn(async (id: string) => ({
    id,
    title: id === 'session-bg' ? '后台会话' : '当前会话',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  })),
  listRoles: vi.fn(async () => []),
  createRole: vi.fn(async (input) => ({ id: 'role-created', description: '', systemPrompt: '', defaultToolIds: [], ...input })),
  updateRole: vi.fn(async (input) => ({ id: input.id, name: input.name ?? 'Role', description: input.description ?? '', systemPrompt: input.systemPrompt ?? '', defaultToolIds: input.defaultToolIds ?? [] })),
  deleteRole: vi.fn(async (id: string) => ({ deleted: true as const, id })),
  listMessages: vi.fn(async (_sessionId?: string) => []),
  listMessagesByRun: vi.fn(async (_input?: { sessionId: string; runId: string }) => []),
  listRuns: vi.fn(async (_sessionId?: string): Promise<any[]> => []),
  listSteps: vi.fn(async (_runId?: string) => []),
  listWorkerInvocationsByParentRun: vi.fn(async (_input?: { sessionId: string; parentRunId: string }) => []),
  enqueue: vi.fn(async () => ({ runId: 'run-1' })),
  stopRun: vi.fn(async (runId: string) => ({
    id: runId,
    sessionId: 'session-1',
    status: 'cancelled',
    modelId: 'mock/hesper-fast',
    retryCount: 0,
    maxRetries: 5,
    endedAt: '2026-06-10T03:00:05.000Z'
  })),
  onEvent: vi.fn(() => () => undefined),
  getSettings: vi.fn(async () => ({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14, soul: '' })),
  updateSettings: vi.fn(async (input: Partial<{ defaultModelId: string; defaultOutputMode: 'markdown' | 'html'; themeMode: 'system' | 'light' | 'dark'; fontSize: number; soul: string }>) => ({
    defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
    defaultOutputMode: input.defaultOutputMode ?? 'markdown',
    themeMode: input.themeMode ?? 'dark',
    fontSize: input.fontSize ?? 14,
    soul: input.soul ?? ''
  })),
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
  listTools: vi.fn(async () => [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      enabled: true
    },
    {
      id: 'web.fetch-url',
      name: 'Fetch URL',
      description: 'Fetch and extract clean page content with the TinyFish Fetch API.',
      category: 'web',
      requiresApiKey: true,
      hasApiKey: false,
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, format: { type: 'string' }, links: { type: 'boolean' }, imageLinks: { type: 'boolean' }, ttl: { type: 'number' }, perUrlTimeoutMs: { type: 'number' } } },
      enabled: false
    },
    {
      id: 'system.show-notification',
      name: 'Show Notification',
      description: 'Show a desktop notification.',
      category: 'system',
      inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
      enabled: false
    }
  ]),
  setToolEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
    id: input.id,
    name: input.id === 'web.fetch-url' ? 'Fetch URL' : input.id === 'web.search' ? 'Web Search' : input.id === 'system.show-notification' ? 'Show Notification' : 'Read File',
    description: input.id === 'web.fetch-url' ? 'Fetch and extract clean page content with the TinyFish Fetch API.' : input.id === 'web.search' ? 'Search the web with TinyFish.' : input.id === 'system.show-notification' ? 'Show a desktop notification.' : 'Read a text file from the selected workspace.',
    category: input.id.startsWith('web.') ? 'web' : input.id.startsWith('system.') ? 'system' : 'filesystem',
    inputSchema: input.id === 'web.fetch-url'
      ? { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
      : input.id === 'web.search'
        ? { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }
        : input.id === 'system.show-notification'
          ? { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }
          : { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    requiresApiKey: input.id === 'web.search' || input.id === 'web.fetch-url' ? true : undefined,
    hasApiKey: input.id === 'web.search' || input.id === 'web.fetch-url' ? input.enabled : undefined,
    enabled: input.enabled
  })),
  toolCredentialStatus: vi.fn(async (input: { toolId: string }) => ({
    toolId: input.toolId,
    apiKeyRef: `tool:${input.toolId}:api-key`,
    hasApiKey: false,
    encryptionAvailable: true
  })),
  saveToolApiKey: vi.fn(async (input: { toolId: string; apiKey: string }) => ({
    toolId: input.toolId,
    apiKeyRef: `tool:${input.toolId}:api-key`,
    hasApiKey: true,
    encryptionAvailable: true,
    updatedAt: '2026-06-10T03:00:00.000Z'
  })),
  deleteToolApiKey: vi.fn(async (input: { toolId: string }) => ({
    toolId: input.toolId,
    apiKeyRef: `tool:${input.toolId}:api-key`,
    hasApiKey: false,
    encryptionAvailable: true
  })),
  sshKeysList: vi.fn(async () => []),
  sshKeysCreate: vi.fn(async (input) => ({
    id: 'ssh-key-created',
    name: input.name,
    publicKey: input.publicKey,
    note: input.note,
    hasPassphrase: Boolean(input.passphrase?.trim()),
    createdAt: '2026-06-21T05:00:00.000Z',
    updatedAt: '2026-06-21T05:00:00.000Z'
  })),
  sshKeysDelete: vi.fn(async (id: string) => ({ deleted: true as const, id })),
  sshServersList: vi.fn(async () => []),
  sshServersCreate: vi.fn(async (input) => ({
    id: 'ssh-server-created',
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    keyId: input.keyId,
    note: input.note,
    createdAt: '2026-06-21T05:00:00.000Z',
    updatedAt: '2026-06-21T05:00:00.000Z'
  })),
  sshServersUpdate: vi.fn(async (input) => ({
    id: input.id,
    name: input.name ?? 'SSH server',
    host: input.host ?? '127.0.0.1',
    port: input.port ?? 22,
    username: input.username ?? 'user',
    keyId: input.keyId ?? 'ssh-key-created',
    note: input.note,
    createdAt: '2026-06-21T05:00:00.000Z',
    updatedAt: '2026-06-21T05:00:00.000Z'
  })),
  sshServersDelete: vi.fn(async (id: string) => ({ deleted: true as const, id })),
  minimizeWindow: vi.fn(async () => ({ minimized: true })),
  toggleMaximizeWindow: vi.fn(async () => ({ isMaximized: true })),
  closeWindow: vi.fn(async () => ({ closed: true }))
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: createSession,
      updateTitle,
      delete: deleteSession,
      generateTitle,
      markViewed
    },
    conversation: { listMessages, listMessagesByRun, listRuns, listSteps },
    workerAgents: { listByParentRun: listWorkerInvocationsByParentRun },
    agent: { enqueue, stop: stopRun, onEvent },
    dialog: { selectDirectory: vi.fn() },
    settings: { get: getSettings, update: updateSettings },
    providers: { list: listProviders },
    models: { list: listModels },
    tools: { list: listTools, setEnabled: setToolEnabled, credentialStatus: toolCredentialStatus, saveApiKey: saveToolApiKey, deleteApiKey: deleteToolApiKey },
    sshKeys: { list: sshKeysList, create: sshKeysCreate, delete: sshKeysDelete },
    sshServers: { list: sshServersList, create: sshServersCreate, update: sshServersUpdate, delete: sshServersDelete },
    roles: { list: listRoles, create: createRole, update: updateRole, delete: deleteRole },
    window: {
      platform: 'win32',
      minimize: minimizeWindow,
      toggleMaximize: toggleMaximizeWindow,
      close: closeWindow
    }
  }
}))

describe('renderer App', () => {
  it('deletes cleared send-error entries instead of keeping undefined keys', () => {
    expect(clearSessionSendError({ 'session-1': 'failed', 'session-2': 'still-here' }, 'session-1')).toEqual({ 'session-2': 'still-here' })
  })

  it('prunes send-error entries for sessions that are no longer visible', () => {
    expect(pruneSessionSendErrors({ 'session-1': 'failed', 'session-2': 'keep' }, ['session-2'])).toEqual({ 'session-2': 'keep' })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    listSessions.mockReset()
    createSession.mockClear()
    updateTitle.mockClear()
    deleteSession.mockClear()
    generateTitle.mockClear()
    markViewed.mockClear()
    listRoles.mockReset()
    createRole.mockClear()
    updateRole.mockClear()
    deleteRole.mockClear()
    listMessages.mockReset()
    listMessagesByRun.mockReset()
    listRuns.mockReset()
    listSteps.mockReset()
    listWorkerInvocationsByParentRun.mockReset()
    enqueue.mockReset()
    stopRun.mockReset()
    onEvent.mockReset()
    getSettings.mockReset()
    updateSettings.mockReset()
    listProviders.mockReset()
    listModels.mockReset()
    listTools.mockReset()
    setToolEnabled.mockClear()
    toolCredentialStatus.mockReset()
    saveToolApiKey.mockReset()
    deleteToolApiKey.mockReset()
    sshKeysList.mockReset()
    sshKeysCreate.mockReset()
    sshKeysDelete.mockReset()
    sshServersList.mockReset()
    sshServersCreate.mockReset()
    sshServersUpdate.mockReset()
    sshServersDelete.mockReset()
    minimizeWindow.mockClear()
    toggleMaximizeWindow.mockClear()
    closeWindow.mockClear()
    listSessions.mockResolvedValue([])
    listRoles.mockResolvedValue([])
    listMessages.mockResolvedValue([])
    listMessagesByRun.mockResolvedValue([])
    listRuns.mockResolvedValue([])
    listSteps.mockResolvedValue([])
    listWorkerInvocationsByParentRun.mockResolvedValue([])
    listProviders.mockResolvedValue([])
    listModels.mockResolvedValue([])
    listTools.mockResolvedValue([
      {
        id: 'filesystem.read-file',
        name: 'Read File',
        description: 'Read a text file from the selected workspace.',
        category: 'filesystem',
        inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
        enabled: true
      },
      {
        id: 'web.fetch-url',
        name: 'Fetch URL',
        description: 'Fetch and extract clean page content with the TinyFish Fetch API.',
        category: 'web',
        requiresApiKey: true,
        hasApiKey: false,
        inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' }, format: { type: 'string' }, links: { type: 'boolean' }, imageLinks: { type: 'boolean' }, ttl: { type: 'number' }, perUrlTimeoutMs: { type: 'number' } } },
        enabled: false
      },
      {
        id: 'system.show-notification',
        name: 'Show Notification',
        description: 'Show a desktop notification.',
        category: 'system',
        inputSchema: { type: 'object', required: ['message'], properties: { message: { type: 'string' } } },
        enabled: false
      }
    ])
    setToolEnabled.mockImplementation(async (input: { id: string; enabled: boolean }) => ({
      id: input.id,
      name: input.id === 'web.fetch-url' ? 'Fetch URL' : input.id === 'web.search' ? 'Web Search' : input.id === 'system.show-notification' ? 'Show Notification' : 'Read File',
      description: input.id === 'web.fetch-url' ? 'Fetch and extract clean page content with the TinyFish Fetch API.' : input.id === 'web.search' ? 'Search the web with TinyFish.' : input.id === 'system.show-notification' ? 'Show a desktop notification.' : 'Read a text file from the selected workspace.',
      category: input.id.startsWith('web.') ? 'web' : input.id.startsWith('system.') ? 'system' : 'filesystem',
      inputSchema: input.id === 'web.fetch-url'
        ? { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
        : input.id === 'web.search'
          ? { type: 'object', required: ['query'], properties: { query: { type: 'string' } } }
          : input.id === 'system.show-notification'
            ? { type: 'object', required: ['message'], properties: { message: { type: 'string' } } }
            : { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      requiresApiKey: input.id === 'web.search' || input.id === 'web.fetch-url' ? true : undefined,
      hasApiKey: input.id === 'web.search' || input.id === 'web.fetch-url' ? input.enabled : undefined,
      enabled: input.enabled
    }))
    toolCredentialStatus.mockImplementation(async (input: { toolId: string }) => ({
      toolId: input.toolId,
      apiKeyRef: `tool:${input.toolId}:api-key`,
      hasApiKey: false,
      encryptionAvailable: true
    }))
    saveToolApiKey.mockImplementation(async (input: { toolId: string; apiKey: string }) => ({
      toolId: input.toolId,
      apiKeyRef: `tool:${input.toolId}:api-key`,
      hasApiKey: true,
      encryptionAvailable: true,
      updatedAt: '2026-06-10T03:00:00.000Z'
    }))
    deleteToolApiKey.mockImplementation(async (input: { toolId: string }) => ({
      toolId: input.toolId,
      apiKeyRef: `tool:${input.toolId}:api-key`,
      hasApiKey: false,
      encryptionAvailable: true
    }))
    sshKeysList.mockResolvedValue([])
    sshKeysCreate.mockImplementation(async (input) => ({
      id: 'ssh-key-created',
      name: input.name,
      publicKey: input.publicKey,
      note: input.note,
      hasPassphrase: Boolean(input.passphrase?.trim()),
      createdAt: '2026-06-21T05:00:00.000Z',
      updatedAt: '2026-06-21T05:00:00.000Z'
    }))
    sshKeysDelete.mockImplementation(async (id: string) => ({ deleted: true as const, id }))
    sshServersList.mockResolvedValue([])
    sshServersCreate.mockImplementation(async (input) => ({
      id: 'ssh-server-created',
      name: input.name,
      host: input.host,
      port: input.port,
      username: input.username,
      keyId: input.keyId,
      note: input.note,
      createdAt: '2026-06-21T05:00:00.000Z',
      updatedAt: '2026-06-21T05:00:00.000Z'
    }))
    sshServersUpdate.mockImplementation(async (input) => ({
      id: input.id,
      name: input.name ?? 'SSH server',
      host: input.host ?? '127.0.0.1',
      port: input.port ?? 22,
      username: input.username ?? 'user',
      keyId: input.keyId ?? 'ssh-key-created',
      note: input.note,
      createdAt: '2026-06-21T05:00:00.000Z',
      updatedAt: '2026-06-21T05:00:00.000Z'
    }))
    sshServersDelete.mockImplementation(async (id: string) => ({ deleted: true as const, id }))
    enqueue.mockResolvedValue({ runId: 'run-1' })
    stopRun.mockImplementation(async (runId: string) => ({
      id: runId,
      sessionId: 'session-1',
      status: 'cancelled',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 5,
      endedAt: '2026-06-10T03:00:05.000Z'
    }))
    onEvent.mockImplementation(() => () => undefined)
    markViewed.mockImplementation(async (id: string) => ({
      id,
      title: id === 'session-bg' ? '后台会话' : '当前会话',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:00.000Z'
    }))
    getSettings.mockResolvedValue({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14, soul: '' })
    updateSettings.mockImplementation(async (input) => ({
      defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
      defaultOutputMode: input.defaultOutputMode ?? 'markdown',
      themeMode: input.themeMode ?? 'dark',
      fontSize: input.fontSize ?? 14,
      soul: input.soul ?? ''
    }))
  })

  it('renders the high-density shell, native titlebar controls, and empty conversation state', async () => {
    const user = userEvent.setup()

    render(<App />)

    expect((await screen.findAllByText('Hesper')).length).toBeGreaterThan(0)
    expect(screen.getByText('所有会话')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '最小化窗口' }))
    await user.click(screen.getByRole('button', { name: '最大化窗口' }))
    await user.click(screen.getByRole('button', { name: '关闭窗口' }))

    expect(minimizeWindow).toHaveBeenCalledTimes(1)
    expect(toggleMaximizeWindow).toHaveBeenCalledTimes(1)
    expect(closeWindow).toHaveBeenCalledTimes(1)
  })

  it('creates a session from the activity rail new-session button', async () => {
    const user = userEvent.setup()

    render(<App />)

    const newSessionButtons = await screen.findAllByRole('button', { name: '新建会话' })
    await user.click(newSessionButtons[0]!)

    expect(createSession).toHaveBeenCalledWith({ title: 'New chat' })
    expect(await screen.findAllByText('New chat')).not.toHaveLength(0)
  })

  it('deletes a newly-created empty session when switching to another session', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      { id: 'session-existing', title: 'Existing chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    createSession.mockResolvedValueOnce({
      id: 'session-new-empty',
      title: 'New chat',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:10.000Z',
      updatedAt: '2026-06-10T03:00:10.000Z'
    } as any)

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Existing chat' })).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: '新建会话' }))[0]!)
    expect(await screen.findAllByText('New chat')).not.toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Existing chat' }))

    await waitFor(() => expect(deleteSession).toHaveBeenCalledWith('session-new-empty'))
  })

  it('keeps an existing default new chat when switching away if it was not created in this view', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      { id: 'session-existing', title: 'Existing chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
      { id: 'session-existing-new-chat', title: 'New chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:10.000Z', updatedAt: '2026-06-10T03:00:10.000Z' }
    ] as any)

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Existing chat' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Existing chat' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Existing chat' })).toHaveAttribute('aria-current', 'true'))
    expect(deleteSession).not.toHaveBeenCalledWith('session-existing-new-chat')
  })

  it('keeps a newly-created session with a draft when switching away', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      { id: 'session-existing', title: 'Existing chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    createSession.mockResolvedValueOnce({
      id: 'session-new-draft',
      title: 'New chat',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:10.000Z',
      updatedAt: '2026-06-10T03:00:10.000Z'
    } as any)

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Existing chat' })).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: '新建会话' }))[0]!)
    await user.type(await screen.findByLabelText('消息输入框'), '保留这个草稿')

    await user.click(screen.getByRole('button', { name: 'Existing chat' }))

    await waitFor(() => expect(screen.getByLabelText('消息输入框')).toHaveValue(''))
    expect(deleteSession).not.toHaveBeenCalledWith('session-new-draft')
  })

  it('keeps a newly-created session with a user message when switching away', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      { id: 'session-existing', title: 'Existing chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    createSession.mockResolvedValueOnce({
      id: 'session-new-message',
      title: 'New chat',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:10.000Z',
      updatedAt: '2026-06-10T03:00:10.000Z'
    } as any)

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Existing chat' })).toBeInTheDocument()
    await user.click((await screen.findAllByRole('button', { name: '新建会话' }))[0]!)
    await user.type(await screen.findByLabelText('消息输入框'), '请读取 README')
    await user.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() => expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-new-message', prompt: '请读取 README' })))

    await user.click(screen.getByRole('button', { name: 'Existing chat' }))

    await waitFor(() => expect(screen.getByLabelText('消息输入框')).toHaveValue(''))
    expect(deleteSession).not.toHaveBeenCalledWith('session-new-message')
  })

  it('keeps a default new chat with a latest run when switching away', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      { id: 'session-existing', title: 'Existing chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
      { id: 'session-new-run', title: 'New chat', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:10.000Z', updatedAt: '2026-06-10T03:00:10.000Z' }
    ] as any)
    listRuns.mockImplementation(async (sessionId?: string) => sessionId === 'session-new-run'
      ? [{ id: 'run-new', sessionId: 'session-new-run', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 5, createdAt: '2026-06-10T03:00:11.000Z' }]
      : [])

    render(<App />)

    expect(await screen.findByRole('button', { name: 'Existing chat' })).toBeInTheDocument()
    await waitFor(() => expect(listRuns).toHaveBeenCalledWith('session-new-run'))

    await user.click(screen.getByRole('button', { name: 'Existing chat' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Existing chat' })).toHaveAttribute('aria-current', 'true'))
    expect(deleteSession).not.toHaveBeenCalledWith('session-new-run')
  })

  it('switches activity sections from the rail and shows extension placeholders', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Existing chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    expect(await screen.findAllByText('Existing chat')).not.toHaveLength(0)
    await user.click(screen.getByRole('button', { name: '工具' }))

    expect(screen.getByRole('button', { name: '工具' })).toHaveAttribute('aria-current', 'page')
    expect(await screen.findByLabelText('工具列表')).toBeInTheDocument()
    expect(screen.getAllByText('Read File')).not.toHaveLength(0)
    expect(screen.getByRole('region', { name: '工具详情' })).toHaveTextContent('Read File')

    await user.click(screen.getByText('Show Notification').closest('[role="button"]') as HTMLElement)
    const detailsRegion = screen.getByRole('region', { name: '工具详情' })
    expect(detailsRegion).toHaveTextContent('Show Notification')
    expect(detailsRegion).toHaveTextContent('关闭')
    expect(screen.queryByText(/当前工具已全局关闭/)).not.toBeInTheDocument()
    const detailSwitch = screen.getByRole('switch', { name: '工具全局开关' })
    expect(detailSwitch).toHaveAttribute('aria-checked', 'false')
    expect(detailSwitch.querySelector('[data-tool-toggle-track="true"]')).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)' })
    expect(detailSwitch.querySelector('[data-tool-toggle-knob="true"]')).toHaveStyle({ transform: 'translateX(0)' })
    await user.click(detailSwitch)
    expect(setToolEnabled).toHaveBeenCalledWith({ id: 'system.show-notification', enabled: true })
  })

  it('renders the roles management section instead of a placeholder', async () => {
    listRoles
      .mockResolvedValueOnce([
        { id: 'role-1', name: '运维助手', description: '执行命令', systemPrompt: '你是运维助手。', defaultToolIds: ['filesystem.read-file'] }
      ] as any)
      .mockResolvedValueOnce([
        { id: 'role-1', name: '运维助手', description: '执行命令', systemPrompt: '你是运维助手。', defaultToolIds: ['filesystem.read-file'] }
      ] as any)

    render(<App />)

    await userEvent.click(screen.getByRole('button', { name: '角色' }))

    expect(await screen.findByRole('button', { name: /运维助手/ })).toBeInTheDocument()
    expect(screen.queryByText('Roles 即将支持')).not.toBeInTheDocument()
    expect(screen.getByLabelText('角色名称')).toHaveValue('运维助手')
  })

  it('refreshes roles when opening the roles section', async () => {
    const user = userEvent.setup()
    const agentCreatedRole = {
      id: 'role-agent-created',
      name: 'Agent 创建的角色',
      description: '后台创建',
      systemPrompt: '你是后台创建的角色。',
      defaultToolIds: ['filesystem.read-file']
    }
    listRoles.mockResolvedValueOnce([]).mockResolvedValueOnce([agentCreatedRole] as any)

    render(<App />)

    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(1))
    await user.click(screen.getByRole('button', { name: '角色' }))

    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('button', { name: /Agent 创建的角色/ })).toBeInTheDocument()
    expect(screen.getByLabelText('角色名称')).toHaveValue('Agent 创建的角色')
  })

  it('does not expose role creation while or after roles load', async () => {
    const user = userEvent.setup()
    const initialRoles = createDeferred<any[]>()
    listRoles.mockReturnValueOnce(initialRoles.promise as any)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))

    expect(screen.getByText('角色加载中…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('角色名称')).not.toBeInTheDocument()

    await act(async () => {
      initialRoles.resolve([])
      await initialRoles.promise
    })

    await waitFor(() => expect(screen.queryByText('角色加载中…')).not.toBeInTheDocument())
    expect((await screen.findAllByText('暂无角色')).length).toBeGreaterThan(0)
    expect(screen.getByText('请让 Agent 创建角色后，再在这里维护名称、简介、提示词和默认工具。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
    expect(createRole).not.toHaveBeenCalled()
  })


  it('updates an existing role and keeps it active after refresh', async () => {
    const user = userEvent.setup()
    const existingRole = {
      id: 'role-1',
      name: '运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file']
    }
    const updatedRole = {
      ...existingRole,
      name: '高级运维助手',
      defaultToolIds: ['filesystem.read-file', 'web.fetch-url']
    }
    listRoles.mockResolvedValueOnce([existingRole] as any).mockResolvedValueOnce([existingRole] as any).mockResolvedValueOnce([updatedRole] as any)
    updateRole.mockResolvedValueOnce(updatedRole)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    const nameInput = await screen.findByLabelText('角色名称')
    await user.clear(nameInput)
    await user.type(nameInput, '高级运维助手')
    await user.click(screen.getByLabelText('Fetch URL'))
    await user.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() => expect(updateRole).toHaveBeenCalledWith(expect.objectContaining({
      id: 'role-1',
      name: '高级运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: ['filesystem.read-file', 'web.fetch-url'],
      defaultModelId: ''
    })))
    expect(await screen.findByRole('button', { name: /高级运维助手/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('角色名称')).toHaveValue('高级运维助手')
  })

  it('deletes a role and selects the first remaining role after refresh', async () => {
    const user = userEvent.setup()
    const firstRole = {
      id: 'role-1',
      name: '运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: []
    }
    const remainingRole = {
      id: 'role-2',
      name: '搜索专家',
      description: '搜索资料',
      systemPrompt: '你是搜索专家。',
      defaultToolIds: ['web.fetch-url']
    }
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    listRoles.mockResolvedValueOnce([firstRole, remainingRole] as any).mockResolvedValueOnce([firstRole, remainingRole] as any).mockResolvedValueOnce([remainingRole] as any)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(await screen.findByLabelText('角色名称')).toHaveValue('运维助手')
    await user.click(screen.getByRole('button', { name: '删除角色' }))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('role-1'))
    expect(await screen.findByRole('button', { name: /搜索专家/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('角色名称')).toHaveValue('搜索专家')
  })

  it('removes a deleted role locally when refresh fails after delete succeeds', async () => {
    const user = userEvent.setup()
    const role = {
      id: 'role-1',
      name: '运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: []
    }
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    listRoles.mockResolvedValueOnce([role] as any).mockResolvedValueOnce([role] as any).mockRejectedValueOnce(new Error('refresh failed'))

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(await screen.findByLabelText('角色名称')).toHaveValue('运维助手')
    await user.click(screen.getByRole('button', { name: '删除角色' }))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledWith('role-1'))
    expect(screen.queryByRole('button', { name: /运维助手/ })).not.toBeInTheDocument()
    expect(screen.getByText('请让 Agent 创建角色后，再在这里维护名称、简介、提示词和默认工具。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('refresh failed')
  })

  it('confirms and deletes selected role ranges from the role list in list order', async () => {
    const user = userEvent.setup()
    const roles = [
      { id: 'role-1', name: '运维助手', description: '执行命令', systemPrompt: '你是运维助手。', defaultToolIds: [] },
      { id: 'role-2', name: '搜索专家', description: '搜索资料', systemPrompt: '你是搜索专家。', defaultToolIds: [] },
      { id: 'role-3', name: '写作助手', description: '撰写文案', systemPrompt: '你是写作助手。', defaultToolIds: [] },
      { id: 'role-4', name: '测试助手', description: '编写测试', systemPrompt: '你是测试助手。', defaultToolIds: [] }
    ]
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    listRoles.mockResolvedValueOnce(roles as any).mockResolvedValueOnce(roles as any).mockResolvedValueOnce([roles[3]] as any)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    const firstRow = await screen.findByRole('button', { name: /运维助手/ })
    const secondRow = screen.getByRole('button', { name: /搜索专家/ })
    const thirdRow = screen.getByRole('button', { name: /写作助手/ })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)
    await user.click(within(screen.getByRole('menu', { name: '角色操作' })).getByRole('menuitem', { name: '删除' }))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(3))
    expect(confirmSpy).toHaveBeenCalledWith('确定要删除选中的 3 个角色吗？')
    expect(deleteRole.mock.calls.map(([roleId]) => roleId)).toEqual(['role-1', 'role-2', 'role-3'])
    expect(await screen.findByRole('button', { name: /测试助手/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('角色名称')).toHaveValue('测试助手')
  })

  it('reloads role list after a bulk delete partially fails and hides already-deleted roles', async () => {
    const user = userEvent.setup()
    const roles = [
      { id: 'role-1', name: '运维助手', description: '执行命令', systemPrompt: '你是运维助手。', defaultToolIds: [] },
      { id: 'role-2', name: '搜索专家', description: '搜索资料', systemPrompt: '你是搜索专家。', defaultToolIds: [] },
      { id: 'role-3', name: '写作助手', description: '撰写文案', systemPrompt: '你是写作助手。', defaultToolIds: [] }
    ]
    const deletedRoleIds = new Set<string>()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    listRoles.mockImplementation(async () => roles.filter((role) => !deletedRoleIds.has(role.id)) as any)
    deleteRole.mockImplementation(async (roleId: string) => {
      if (roleId === 'role-2') {
        throw new Error('delete role-2 failed')
      }
      deletedRoleIds.add(roleId)
      return { deleted: true as const, id: roleId }
    })

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    const firstRow = await screen.findByRole('button', { name: /运维助手/ })
    const secondRow = screen.getByRole('button', { name: /搜索专家/ })
    const thirdRow = screen.getByRole('button', { name: /写作助手/ })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)
    await user.click(within(screen.getByRole('menu', { name: '角色操作' })).getByRole('menuitem', { name: '删除' }))

    await waitFor(() => expect(deleteRole).toHaveBeenCalledTimes(2))
    expect(confirmSpy).toHaveBeenCalledWith('确定要删除选中的 3 个角色吗？')
    expect(deleteRole.mock.calls.map(([roleId]) => roleId)).toEqual(['role-1', 'role-2'])
    expect(screen.queryByRole('button', { name: /运维助手/ })).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /搜索专家/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /写作助手/ })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('delete role-2 failed')
  })

  it('ignores role list selection while a role mutation is pending', async () => {
    const user = userEvent.setup()
    const updateDeferred = createDeferred<any>()
    const firstRole = {
      id: 'role-1',
      name: '运维助手',
      description: '执行命令',
      systemPrompt: '你是运维助手。',
      defaultToolIds: []
    }
    const secondRole = {
      id: 'role-2',
      name: '搜索专家',
      description: '搜索资料',
      systemPrompt: '你是搜索专家。',
      defaultToolIds: []
    }
    listRoles.mockResolvedValueOnce([firstRole, secondRole] as any).mockResolvedValueOnce([firstRole, secondRole] as any).mockResolvedValueOnce([firstRole, secondRole] as any)
    updateRole.mockReturnValueOnce(updateDeferred.promise)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(await screen.findByLabelText('角色名称')).toHaveValue('运维助手')
    await user.type(screen.getByLabelText('角色简介'), ' updated')
    await user.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(updateRole).toHaveBeenCalled())

    const firstRow = screen.getByRole('button', { name: /运维助手/ })
    const secondRow = screen.getByRole('button', { name: /搜索专家/ })
    await user.click(secondRow)
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()

    expect(firstRow).toHaveAttribute('aria-current', 'page')
    expect(secondRow).not.toHaveClass('is-selected')
    expect(secondRow).not.toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('角色名称')).toHaveValue('运维助手')
    expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument()

    await act(async () => {
      updateDeferred.resolve(firstRole)
    })
    await waitFor(() => expect(screen.getByLabelText('角色名称')).toHaveValue('运维助手'))
  })

  it('shows loaded roles after a pending initial load without exposing creation', async () => {
    const user = userEvent.setup()
    const initialRoles = createDeferred<any[]>()
    const loadedRole = {
      id: 'role-loaded',
      name: '已有角色',
      description: '服务端已有',
      systemPrompt: '已有提示词',
      defaultToolIds: []
    }
    listRoles.mockReturnValueOnce(initialRoles.promise as any)

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(screen.getByText('角色加载中…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('角色名称')).not.toBeInTheDocument()

    await act(async () => {
      initialRoles.resolve([loadedRole])
      await initialRoles.promise
    })

    expect(await screen.findByRole('button', { name: /已有角色/ })).toBeInTheDocument()
    expect(screen.getByLabelText('角色名称')).toHaveValue('已有角色')
    expect(createRole).not.toHaveBeenCalled()
  })

  it('does not expose role creation after the initial roles load fails', async () => {
    const user = userEvent.setup()
    listRoles.mockRejectedValueOnce(new Error('initial failed')).mockRejectedValueOnce(new Error('initial failed'))

    render(<App />)

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('initial failed')
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建角色' })).not.toBeInTheDocument()
    expect(createRole).not.toHaveBeenCalled()
  })

  it('manages API keys for credential-required tools from the tools detail panel', async () => {
    const user = userEvent.setup()
    const toolsWithoutKey = [
      {
        id: 'filesystem.read-file',
        name: 'Read File',
        description: 'Read a text file from the selected workspace.',
        category: 'filesystem',
        inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
        enabled: true
      },
      {
        id: 'web.search',
        name: 'Web Search',
        description: 'Search the web with TinyFish.',
        category: 'web',
        requiresApiKey: true,
        hasApiKey: false,
        inputSchema: { type: 'object', required: ['query'], properties: { query: { type: 'string' } } },
        enabled: false
      }
    ]
    const toolsWithKey = [{ ...toolsWithoutKey[0] }, { ...toolsWithoutKey[1], hasApiKey: true, enabled: true }]
    listTools.mockResolvedValueOnce(toolsWithoutKey as any).mockResolvedValueOnce(toolsWithKey as any)
    toolCredentialStatus.mockResolvedValueOnce({ toolId: 'web.search', apiKeyRef: 'tool:web.search:api-key', hasApiKey: false, encryptionAvailable: true })

    render(<App />)
    await user.click(screen.getByRole('button', { name: '工具' }))
    await user.click(await screen.findByText('Web Search'))

    const detailsRegion = screen.getByRole('region', { name: '工具详情' })
    expect(detailsRegion).toHaveTextContent('未保存')
    expect(screen.getByRole('switch', { name: '工具全局开关' })).toBeDisabled()

    await user.type(screen.getByLabelText('TinyFish API Key'), 'tinyfish-secret')
    await user.click(screen.getByRole('button', { name: '保存 API Key' }))

    await waitFor(() => expect(saveToolApiKey).toHaveBeenCalledWith({ toolId: 'web.search', apiKey: 'tinyfish-secret' }))
    await waitFor(() => expect(detailsRegion).toHaveTextContent('已保存'))
    expect(screen.getByRole('switch', { name: '工具全局开关' })).not.toBeDisabled()
  })

  it('manages SSH keys and hosts from SSH settings without exposing secrets in SSH tool details', async () => {
    const user = userEvent.setup()
    const savedKeys: any[] = []
    const savedServers: any[] = []
    listTools.mockResolvedValueOnce([
      {
        id: 'ssh.run-commands',
        name: 'Run SSH Commands',
        description: 'Run multiple commands sequentially on a configured SSH server.',
        category: 'system',
        icon: '🔐',
        inputSchema: { type: 'object', required: ['serverId', 'commands'], properties: { serverId: { type: 'string' }, commands: { type: 'array', items: { type: 'string' } } } },
        enabled: true
      }
    ] as any)
    sshKeysList.mockImplementation(async () => savedKeys as any)
    sshServersList.mockImplementation(async () => savedServers as any)
    sshKeysCreate.mockImplementation(async (input) => {
      const key = { id: 'ssh-key-1', name: input.name, publicKey: input.publicKey, note: undefined, hasPassphrase: false, createdAt: '2026-06-21T05:00:00.000Z', updatedAt: '2026-06-21T05:00:00.000Z' }
      savedKeys.splice(0, savedKeys.length, key)
      return key
    })
    sshServersCreate.mockImplementation(async (input) => {
      const server = { id: 'ssh-server-1', name: input.name, host: input.host, port: input.port, username: input.username, keyId: input.keyId, note: input.note, createdAt: '2026-06-21T05:00:00.000Z', updatedAt: '2026-06-21T05:00:00.000Z' }
      savedServers.splice(0, savedServers.length, server)
      return server
    })
    sshServersUpdate.mockImplementation(async (input) => {
      const current = savedServers.find((server) => server.id === input.id) ?? savedServers[0]
      const updated = { ...current, ...input, updatedAt: '2026-06-21T05:10:00.000Z' }
      savedServers.splice(0, savedServers.length, updated)
      return updated
    })

    render(<App />)
    await user.click(screen.getByRole('button', { name: '工具' }))
    const toolsList = await screen.findByLabelText('工具列表')
    await user.click(toolsList.querySelector('[data-tool-id="ssh.run-commands"]') as HTMLElement)

    expect(screen.getByRole('region', { name: '工具详情' })).toHaveTextContent('Run SSH Commands')
    expect(screen.queryByRole('region', { name: 'SSH 配置' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('SSH 私钥内容')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '设置' }))
    await user.click(await screen.findByRole('button', { name: 'SSH 设置' }))

    expect(await screen.findByRole('region', { name: 'SSH 设置面板' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'SSH 密钥管理' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'SSH 主机管理' })).toBeInTheDocument()
    const appRoot = screen.getByLabelText('主工作区').parentElement

    await user.click(screen.getByRole('button', { name: '添加 SSH 密钥' }))
    const keyDialog = await screen.findByRole('dialog', { name: '添加 SSH 密钥' })
    expect(keyDialog).toBeInTheDocument()
    expect(appRoot).toContainElement(keyDialog)
    await user.type(screen.getByLabelText('SSH 密钥名称'), 'Prod key')
    await user.type(screen.getByLabelText('SSH 公钥内容'), 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example')
    await user.type(screen.getByLabelText('SSH 私钥内容'), 'private-key-secret')
    await user.click(screen.getByRole('button', { name: '保存 SSH 密钥' }))

    await waitFor(() => expect(sshKeysCreate).toHaveBeenCalledWith({ name: 'Prod key', publicKey: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAprod prod@example', privateKey: 'private-key-secret' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加 SSH 密钥' })).not.toBeInTheDocument())
    expect(screen.getByText('Prod key')).toBeInTheDocument()
    expect(screen.getByText(/ssh-ed25519/)).toBeInTheDocument()
    expect(screen.queryByText('private-key-secret')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '添加 SSH 主机' }))
    const hostDialog = await screen.findByRole('dialog', { name: '添加 SSH 主机' })
    expect(hostDialog).toBeInTheDocument()
    expect(appRoot).toContainElement(hostDialog)
    await user.type(screen.getByLabelText('SSH 主机名称'), 'Prod host')
    await user.type(screen.getByLabelText('主机 IP 地址'), '10.0.0.8')
    await user.clear(screen.getByLabelText('SSH 端口'))
    await user.type(screen.getByLabelText('SSH 端口'), '22')
    await user.type(screen.getByLabelText('SSH 用户名'), 'deploy')
    await user.selectOptions(screen.getByLabelText('SSH 密钥'), 'ssh-key-1')
    expect(screen.getByLabelText('主机备注').tagName).toBe('TEXTAREA')
    await user.type(screen.getByLabelText('主机备注'), 'logs')
    await user.click(screen.getByRole('button', { name: '保存 SSH 主机' }))

    await waitFor(() => expect(sshServersCreate).toHaveBeenCalledWith({ name: 'Prod host', host: '10.0.0.8', port: 22, username: 'deploy', keyId: 'ssh-key-1', note: 'logs' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '添加 SSH 主机' })).not.toBeInTheDocument())
    expect(screen.getByText('Prod host')).toBeInTheDocument()
    expect(screen.getByText(/10\.0\.0\.\*\*\*:22/)).toBeInTheDocument()
    expect(screen.queryByText('10.0.0.8:22')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '编辑 SSH 主机 Prod host' }))
    const editDialog = await screen.findByRole('dialog', { name: '编辑 SSH 主机' })
    expect(editDialog).toBeInTheDocument()
    expect(appRoot).toContainElement(editDialog)
    expect(screen.getByLabelText('SSH 主机名称')).toHaveValue('Prod host')
    expect(screen.getByLabelText('主机 IP 地址')).toHaveValue('10.0.0.8')
    expect(screen.getByLabelText('SSH 端口')).toHaveValue(22)
    expect(screen.getByLabelText('SSH 用户名')).toHaveValue('deploy')
    expect(screen.getByLabelText('SSH 密钥')).toHaveValue('ssh-key-1')
    expect(screen.getByLabelText('主机备注').tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('主机备注')).toHaveValue('logs')

    await user.clear(screen.getByLabelText('SSH 主机名称'))
    await user.type(screen.getByLabelText('SSH 主机名称'), 'Prod host updated')
    await user.clear(screen.getByLabelText('主机 IP 地址'))
    await user.type(screen.getByLabelText('主机 IP 地址'), '10.0.0.9')
    await user.clear(screen.getByLabelText('SSH 端口'))
    await user.type(screen.getByLabelText('SSH 端口'), '2222')
    await user.clear(screen.getByLabelText('SSH 用户名'))
    await user.type(screen.getByLabelText('SSH 用户名'), 'ubuntu')
    await user.clear(screen.getByLabelText('主机备注'))
    await user.type(screen.getByLabelText('主机备注'), 'metrics')
    await user.click(screen.getByRole('button', { name: '保存 SSH 主机' }))

    await waitFor(() => expect(sshServersUpdate).toHaveBeenCalledWith({ id: 'ssh-server-1', name: 'Prod host updated', host: '10.0.0.9', port: 2222, username: 'ubuntu', keyId: 'ssh-key-1', note: 'metrics' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑 SSH 主机' })).not.toBeInTheDocument())
    expect(await screen.findByText('Prod host updated')).toBeInTheDocument()
    expect(screen.getByText(/10\.0\.0\.\*\*\*:2222/)).toBeInTheDocument()
  })

  it('shows unread completion icon for background runs until the session is viewed', async () => {
    const user = userEvent.setup()
    let agentListener: ((event: any) => void) | undefined
    onEvent.mockImplementation(((listener: (event: any) => void) => {
      agentListener = listener
      return () => undefined
    }) as any)
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-active',
        title: '当前会话',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:05:00.000Z'
      },
      {
        id: 'session-bg',
        title: '后台会话',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    const backgroundRow = await screen.findByRole('button', { name: '后台会话' })
    expect(backgroundRow.querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument()
    await act(async () => {
      agentListener?.({
        type: 'message.completed',
        message: {
          id: 'message-bg-assistant',
          sessionId: 'session-bg',
          role: 'assistant',
          content: '后台结果',
          contentType: 'markdown',
          runId: 'run-bg',
          createdAt: '2026-06-10T03:06:00.000Z'
        }
      } as any)
    })

    await waitFor(() => expect(screen.getByRole('button', { name: '后台会话' }).querySelector('[data-session-unread-icon="new-message"]')).toBeInTheDocument())
    expect(markViewed).not.toHaveBeenCalledWith('session-bg')

    await user.click(screen.getByRole('button', { name: '后台会话' }))
    await waitFor(() => expect(markViewed).toHaveBeenCalledWith('session-bg'))
    await waitFor(() => expect(screen.getByRole('button', { name: '后台会话' }).querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument())
  })

  it('clears persisted unread state when the initially selected session is viewed', async () => {
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-active',
        title: '当前会话',
        status: 'active',
        outputMode: 'markdown',
        unreadCompletedAt: '2026-06-10T03:06:00.000Z',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:05:00.000Z'
      }
    ] as any)

    render(<App />)

    await screen.findByRole('button', { name: '当前会话' })
    await waitFor(() => expect(markViewed).toHaveBeenCalledWith('session-active'))
    await waitFor(() => expect(screen.getByRole('button', { name: '当前会话' }).querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument())
  })

  it('opens appearance settings and persists theme mode and global font size', async () => {
    const user = userEvent.setup()
    let storedSettings: { defaultModelId: string; defaultOutputMode: 'markdown' | 'html'; themeMode: 'system' | 'light' | 'dark'; fontSize: number; soul: string } = {
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'dark',
      fontSize: 14,
      soul: ''
    }
    getSettings.mockImplementation(async () => storedSettings)
    updateSettings.mockImplementation(async (input) => {
      storedSettings = { ...storedSettings, ...input }
      return storedSettings
    })

    render(<App />)

    await user.click(await screen.findByRole('button', { name: '设置' }))
    await user.click(screen.getByRole('button', { name: '外观设置' }))

    expect(screen.getByRole('region', { name: '外观设置面板' })).toBeInTheDocument()
    const appRoot = screen.getByLabelText('主工作区').parentElement
    await waitFor(() => expect(appRoot?.style.getPropertyValue('--hesper-color-background')).toBe('#1a1b26'))
    expect(appRoot?.style.getPropertyValue('--hesper-color-accent')).toBe('#7aa2f7')
    expect(appRoot?.style.getPropertyValue('--hesper-color-tool-toggle')).toBe('#7aa2f7')
    expect(appRoot?.style.getPropertyValue('--hesper-color-tool-toggle-soft')).toBe('rgba(122, 162, 247, 0.14)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb')).toBe('rgba(192, 202, 245, 0.10)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-hover')).toBe('rgba(192, 202, 245, 0.24)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-active')).toBe('rgba(192, 202, 245, 0.38)')

    await user.click(screen.getByRole('button', { name: /^亮色/ }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ themeMode: 'light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(appRoot?.style.getPropertyValue('--hesper-color-background')).toBe('#dce0e8')
    expect(appRoot?.style.getPropertyValue('--hesper-color-accent')).toBe('#8839ef')
    expect(appRoot?.style.getPropertyValue('--hesper-color-tool-toggle')).toBe('#40a02b')
    expect(appRoot?.style.getPropertyValue('--hesper-color-tool-toggle-soft')).toBe('rgba(64, 160, 43, 0.14)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb')).toBe('rgba(76, 79, 105, 0.10)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-hover')).toBe('rgba(76, 79, 105, 0.22)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-active')).toBe('rgba(76, 79, 105, 0.36)')

    await user.click(screen.getByRole('button', { name: '16px' }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ fontSize: 16 }))
    expect(screen.getByLabelText('主工作区').parentElement?.style.getPropertyValue('--hesper-font-size')).toBe('16px')
  })

  it('loads the active session conversation history after sessions load and renders persisted messages', async () => {
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Restored chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    listMessages.mockResolvedValueOnce([
      {
        id: 'message-restored-user',
        sessionId: 'session-1',
        role: 'user',
        content: 'persisted hello',
        contentType: 'plain',
        runId: 'run-restored',
        createdAt: '2026-06-10T03:00:01.000Z'
      },
      {
        id: 'message-restored-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'persisted response',
        contentType: 'markdown',
        runId: 'run-restored',
        createdAt: '2026-06-10T03:00:02.000Z'
      }
    ] as any)
    listRuns.mockResolvedValueOnce([
      { id: 'run-restored', sessionId: 'session-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 }
    ] as any)
    listSteps.mockResolvedValueOnce([
      { id: 'step-restored', runId: 'run-restored', type: 'thought', status: 'succeeded', title: 'Restored thought', createdAt: '2026-06-10T03:00:01.500Z' }
    ] as any)

    render(<App />)

    expect(await screen.findByText('persisted hello')).toBeInTheDocument()
    expect(screen.getByText('persisted response')).toBeInTheDocument()
    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith('session-1')
      expect(listRuns).toHaveBeenCalledWith('session-1')
      expect(listSteps).toHaveBeenCalledWith('run-restored')
    })
  })

  it('retries loading worker history when the first attempt fails before a session is marked loaded', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Root chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      },
      {
        id: 'session-2',
        title: 'Other chat',
        status: 'archived',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:10:00.000Z',
        updatedAt: '2026-06-10T03:10:00.000Z'
      }
    ] as any)
    listMessages.mockImplementation(async (sessionId?: string) => (sessionId === 'session-1'
      ? [
          { id: 'message-root-user', sessionId: 'session-1', role: 'user', content: 'root prompt', contentType: 'plain', runId: 'run-root', createdAt: '2026-06-10T03:00:01.000Z' },
          { id: 'message-root-assistant', sessionId: 'session-1', role: 'assistant', content: 'root response', contentType: 'markdown', runId: 'run-root', createdAt: '2026-06-10T03:00:02.000Z' }
        ] as any
      : [] as any))
    listRuns.mockImplementation(async (sessionId?: string) => (sessionId === 'session-1'
      ? [{ id: 'run-root', sessionId: 'session-1', status: 'succeeded', modelId: 'mock/hesper-fast', retryCount: 0, maxRetries: 2 }] as any
      : [] as any))
    listSteps.mockImplementation(async (runId?: string) => (runId === 'run-root'
      ? [{ id: 'step-root', runId: 'run-root', type: 'thought', status: 'succeeded', title: 'Root thought', createdAt: '2026-06-10T03:00:01.500Z' }] as any
      : runId === 'run-child'
        ? [{ id: 'step-child', runId: 'run-child', type: 'thought', status: 'succeeded', title: 'Child thought', createdAt: '2026-06-10T03:00:02.500Z' }] as any
        : [] as any))
    listMessagesByRun.mockImplementation(async (input?: { sessionId: string; runId: string }) => (input?.runId === 'run-child'
      ? [{ id: 'message-child', sessionId: 'session-1', role: 'assistant', content: 'child response', contentType: 'markdown', runId: 'run-child', createdAt: '2026-06-10T03:00:03.000Z' }] as any
      : [] as any))
    listWorkerInvocationsByParentRun.mockRejectedValueOnce(new Error('worker history unavailable'))
    listWorkerInvocationsByParentRun.mockResolvedValueOnce([
      {
        id: 'worker-invocation-1',
        parentRunId: 'run-root',
        childRunId: 'run-child',
        task: 'Review the diff.',
        roleId: 'worker-reviewer',
        allowedToolIds: ['filesystem.read-file'],
        status: 'succeeded',
        createdAt: '2026-06-10T03:00:02.000Z'
      }
    ] as any)

    render(<App />)

    expect(await screen.findByText('root prompt')).toBeInTheDocument()
    expect(await screen.findByText('root response')).toBeInTheDocument()
    await waitFor(() => expect(listWorkerInvocationsByParentRun).toHaveBeenCalledTimes(1))

    await user.click(await screen.findByRole('button', { name: 'Other chat' }))
    await user.click(await screen.findByRole('button', { name: 'Root chat' }))

    await waitFor(() => {
      expect(listMessages.mock.calls.filter(([sessionId]) => sessionId === 'session-1')).toHaveLength(2)
      expect(listRuns.mock.calls.filter(([sessionId]) => sessionId === 'session-1')).toHaveLength(2)
      expect(listWorkerInvocationsByParentRun.mock.calls.filter((args) => args[0]?.sessionId === 'session-1')).toHaveLength(2)
    })
    expect(screen.queryByText('历史加载失败：worker history unavailable')).not.toBeInTheDocument()
  })

  it('shows a minimal error state when initial sessions load fails', async () => {
    listSessions.mockRejectedValueOnce(new Error('IPC unavailable'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('会话加载失败：IPC unavailable')
  })

  it('handles session context-menu rename action inline without browser prompt', async () => {
    const user = userEvent.setup()
    const promptSpy = vi.spyOn(window, 'prompt')

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Existing chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    const row = (await screen.findAllByRole('button', { name: 'Existing chat' }))[0]!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }))

    const renameInput = await screen.findByLabelText('重命名会话标题')
    expect(renameInput).toHaveValue('Existing chat')
    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed chat{Enter}')

    expect(promptSpy).not.toHaveBeenCalled()
    expect(updateTitle).toHaveBeenCalledWith({ id: 'session-1', title: 'Renamed chat' })
    expect(await screen.findAllByText('Renamed chat')).not.toHaveLength(0)
  })

  it('keeps the submitted session title visible while rename persistence is pending', async () => {
    const user = userEvent.setup()
    let resolveRename!: (value: Awaited<ReturnType<typeof updateTitle>>) => void
    updateTitle.mockImplementationOnce((_input: { id: string; title: string }) => new Promise((resolve) => {
      resolveRename = resolve
    }) as ReturnType<typeof updateTitle>)

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Existing chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    const row = (await screen.findAllByRole('button', { name: 'Existing chat' }))[0]!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '重命名' }))

    const renameInput = await screen.findByLabelText('重命名会话标题')
    await user.clear(renameInput)
    await user.type(renameInput, 'Renamed chat{Enter}')

    await waitFor(() => expect(updateTitle).toHaveBeenCalledWith({ id: 'session-1', title: 'Renamed chat' }))
    expect(screen.queryByText('Existing chat')).not.toBeInTheDocument()
    expect(screen.getAllByText('Renamed chat').length).toBeGreaterThan(0)

    resolveRename({
      id: 'session-1',
      title: 'Renamed chat',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:12.000Z'
    } as any)
    await waitFor(() => expect(screen.getAllByText('Renamed chat').length).toBeGreaterThan(0))
  })

  it('deletes a session from the context menu without confirmation', async () => {
    const user = userEvent.setup()
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Delete me',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    const row = (await screen.findAllByRole('button', { name: 'Delete me' }))[0]!
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(deleteSession).toHaveBeenCalledWith('session-1')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete me' })).not.toBeInTheDocument())
  })

  it('deletes shift-selected sessions from the context menu without deleting unselected sessions', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      { id: 'session-1', title: 'Chat one', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:04.000Z' },
      { id: 'session-2', title: 'Chat two', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:03.000Z' },
      { id: 'session-3', title: 'Chat three', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:02.000Z' },
      { id: 'session-4', title: 'Chat four', status: 'active', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:01.000Z' }
    ] as any)

    render(<App />)

    const firstRow = await screen.findByRole('button', { name: 'Chat one' })
    const secondRow = await screen.findByRole('button', { name: 'Chat two' })
    const thirdRow = await screen.findByRole('button', { name: 'Chat three' })
    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)
    await user.click(await screen.findByRole('menuitem', { name: '删除' }))

    await waitFor(() => expect(deleteSession).toHaveBeenCalledTimes(3))
    expect(deleteSession).toHaveBeenNthCalledWith(1, 'session-1')
    expect(deleteSession).toHaveBeenNthCalledWith(2, 'session-2')
    expect(deleteSession).toHaveBeenNthCalledWith(3, 'session-3')
    expect(deleteSession).not.toHaveBeenCalledWith('session-4')
  })

  it('regenerates titles for shift-selected sessions from the context menu', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      { id: 'session-1', title: 'Chat one', status: 'active', defaultModelId: 'model-one', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:03.000Z' },
      { id: 'session-2', title: 'Chat two', status: 'active', defaultModelId: 'model-two', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:02.000Z' },
      { id: 'session-3', title: 'Chat three', status: 'active', defaultModelId: 'model-three', outputMode: 'markdown', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:01.000Z' }
    ] as any)
    listMessages.mockImplementation(async (sessionId?: string) => [
      { id: `message-${sessionId}-user`, sessionId, role: 'user', content: `Prompt ${sessionId}`, contentType: 'plain', createdAt: '2026-06-10T03:00:01.000Z' },
      { id: `message-${sessionId}-assistant`, sessionId, role: 'assistant', content: `Output ${sessionId}`, contentType: 'markdown', createdAt: '2026-06-10T03:00:02.000Z' }
    ] as any)

    render(<App />)

    const firstRow = await screen.findByRole('button', { name: 'Chat one' })
    const secondRow = await screen.findByRole('button', { name: 'Chat two' })
    const thirdRow = await screen.findByRole('button', { name: 'Chat three' })
    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)
    await user.click(await screen.findByRole('menuitem', { name: '重新生成标题' }))

    await waitFor(() => expect(generateTitle).toHaveBeenCalledTimes(3))
    expect(generateTitle).toHaveBeenNthCalledWith(1, {
      id: 'session-1',
      modelId: 'model-one',
      userPrompt: 'Prompt session-1',
      assistantOutput: 'Output session-1'
    })
    expect(generateTitle).toHaveBeenNthCalledWith(2, {
      id: 'session-2',
      modelId: 'model-two',
      userPrompt: 'Prompt session-2',
      assistantOutput: 'Output session-2'
    })
    expect(generateTitle).toHaveBeenNthCalledWith(3, {
      id: 'session-3',
      modelId: 'model-three',
      userPrompt: 'Prompt session-3',
      assistantOutput: 'Output session-3'
    })
  })

  it('regenerates a context-menu session title from persisted history when history is not loaded', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-active',
        title: 'Active chat',
        status: 'active',
        defaultModelId: 'deepseek-active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:10.000Z'
      },
      {
        id: 'session-2',
        title: 'Dormant chat',
        status: 'active',
        defaultModelId: 'deepseek-chat',
        outputMode: 'markdown',
        createdAt: '2026-06-10T02:00:00.000Z',
        updatedAt: '2026-06-10T02:00:00.000Z'
      }
    ] as any)
    listMessages.mockImplementation(async (sessionId?: string) => sessionId === 'session-2'
      ? [
          { id: 'message-user-1', sessionId: 'session-2', role: 'user', content: '第一轮旧问题', contentType: 'plain', createdAt: '2026-06-10T02:00:01.000Z' },
          { id: 'message-assistant-1', sessionId: 'session-2', role: 'assistant', content: '第一轮旧回答', contentType: 'markdown', createdAt: '2026-06-10T02:00:02.000Z' },
          { id: 'message-user-2', sessionId: 'session-2', role: 'user', content: '最近一次用户输入', contentType: 'plain', createdAt: '2026-06-10T02:05:01.000Z' },
          { id: 'message-assistant-2', sessionId: 'session-2', role: 'assistant', content: '最近一次 Agent 回答', contentType: 'markdown', createdAt: '2026-06-10T02:05:02.000Z' }
        ] as any
      : [] as any)

    render(<App />)

    const row = await screen.findByRole('button', { name: 'Dormant chat' })
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '重新生成标题' }))

    await waitFor(() => {
      expect(listMessages).toHaveBeenCalledWith('session-2')
      expect(generateTitle).toHaveBeenCalledWith({
        id: 'session-2',
        modelId: 'deepseek-chat',
        userPrompt: '最近一次用户输入',
        assistantOutput: '最近一次 Agent 回答'
      })
    })
  })

  it('shows a visible error when context-menu title regeneration fails', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-2',
        title: 'Dormant chat',
        status: 'active',
        defaultModelId: 'deepseek-chat',
        outputMode: 'markdown',
        createdAt: '2026-06-10T02:00:00.000Z',
        updatedAt: '2026-06-10T02:00:00.000Z'
      }
    ] as any)
    listMessages.mockResolvedValue([
      { id: 'message-user-1', sessionId: 'session-2', role: 'user', content: '最近一次用户输入', contentType: 'plain', createdAt: '2026-06-10T02:05:01.000Z' }
    ] as any)
    generateTitle.mockRejectedValueOnce(new Error('Model provider needs an API key: deepseek'))

    render(<App />)

    const row = await screen.findByRole('button', { name: 'Dormant chat' })
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '重新生成标题' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('标题生成失败：Model provider needs an API key: deepseek')
  })

  it('shows a visible error when no user message can seed title regeneration', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-empty',
        title: 'Empty chat',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T02:00:00.000Z',
        updatedAt: '2026-06-10T02:00:00.000Z'
      }
    ] as any)
    listMessages.mockResolvedValue([])

    render(<App />)

    const row = await screen.findByRole('button', { name: 'Empty chat' })
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 160 }))
    await user.click(await screen.findByRole('menuitem', { name: '重新生成标题' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('标题生成失败：没有可用于生成标题的用户消息')
    expect(generateTitle).not.toHaveBeenCalled()
  })

  it('generates a concise title after the first assistant turn completes', async () => {
    const user = userEvent.setup()
    let runtimeListener: ((event: { type: string; [key: string]: unknown }) => void) | undefined

    listProviders.mockResolvedValueOnce([
      { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, hasApiKey: true, defaultModelId: 'deepseek-title', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    listModels.mockResolvedValueOnce([
      { id: 'deepseek-title', providerId: 'deepseek', modelName: 'deepseek-title', displayName: 'DeepSeek Title', capabilities: ['streaming'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
      { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'New chat',
        status: 'active',
        defaultModelId: 'deepseek-chat',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    onEvent.mockImplementation(((listener: (event: { type: string; [key: string]: unknown }) => void) => {
      runtimeListener = listener
      return () => {
        runtimeListener = undefined
      }
    }) as any)

    render(<App />)

    await user.type(await screen.findByPlaceholderText(/输入消息/), '请规划一个发布会视频脚本')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByText('请规划一个发布会视频脚本')).toBeInTheDocument()

    runtimeListener?.({
      type: 'run.created',
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        status: 'running',
        modelId: 'deepseek-chat',
        retryCount: 0,
        maxRetries: 5
      }
    })
    runtimeListener?.({
      type: 'message.completed',
      message: {
        id: 'message-assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: '可以，标题、分镜、旁白和镜头节奏可以这样安排。',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: '2026-06-10T03:00:10.000Z'
      }
    })

    await waitFor(() => {
      expect(generateTitle).toHaveBeenCalledWith({
        id: 'session-1',
        modelId: 'deepseek-chat',
        userPrompt: '请规划一个发布会视频脚本',
        assistantOutput: '可以，标题、分镜、旁白和镜头节奏可以这样安排。'
      })
    })
    expect(await screen.findAllByText('模型生成标题')).not.toHaveLength(0)
  })

  it('preserves separate composer drafts for each session', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-a',
        title: '会话 A',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:02.000Z'
      },
      {
        id: 'session-b',
        title: '会话 B',
        status: 'active',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:01.000Z'
      }
    ] as any)

    render(<App />)

    const composer = await screen.findByPlaceholderText(/输入消息/)
    await user.type(composer, 'A draft')
    expect(composer).toHaveValue('A draft')

    await user.click(screen.getByRole('button', { name: '会话 B' }))
    const switchedComposer = await screen.findByPlaceholderText(/输入消息/)
    expect(switchedComposer).toHaveValue('')
    await user.type(switchedComposer, 'B draft')
    expect(switchedComposer).toHaveValue('B draft')

    await user.click(screen.getByRole('button', { name: '会话 A' }))
    expect(await screen.findByPlaceholderText(/输入消息/)).toHaveValue('A draft')

    await user.click(screen.getByRole('button', { name: '会话 B' }))
    expect(await screen.findByPlaceholderText(/输入消息/)).toHaveValue('B draft')
  })

  it('shows a stop button for the active running session and stops its run', async () => {
    const user = userEvent.setup()
    let runtimeListener: ((event: { type: string; [key: string]: unknown }) => void) | undefined

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Running chat',
        status: 'active',
        defaultModelId: 'mock/hesper-fast',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    onEvent.mockImplementation(((listener: (event: { type: string; [key: string]: unknown }) => void) => {
      runtimeListener = listener
      return () => {
        runtimeListener = undefined
      }
    }) as any)

    render(<App />)

    await screen.findByRole('button', { name: '发送' })
    await act(async () => {
      runtimeListener?.({
        type: 'run.created',
        run: {
          id: 'run-running',
          sessionId: 'session-1',
          status: 'running',
          modelId: 'mock/hesper-fast',
          retryCount: 0,
          maxRetries: 5
        }
      })
    })

    await user.click(await screen.findByRole('button', { name: '停止' }))

    expect(stopRun).toHaveBeenCalledWith('run-running')
    await act(async () => {
      runtimeListener?.({ type: 'run.cancelled', runId: 'run-running', endedAt: '2026-06-10T03:00:05.000Z' })
    })
    expect(await screen.findByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('sends messages through IPC, renders optimistic user text, and hydrates assistant output from runtime events', async () => {
    const user = userEvent.setup()
    let runtimeListener: ((event: { type: string; [key: string]: unknown }) => void) | undefined

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Task 11',
        status: 'active',
        workspacePath: 'C:/workspace',
        defaultModelId: 'mock/hesper-fast',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    onEvent.mockImplementation(((listener: (event: { type: string; [key: string]: unknown }) => void) => {
      runtimeListener = listener
      return () => {
        runtimeListener = undefined
      }
    }) as any)

    render(<App />)

    const composer = await screen.findByPlaceholderText(/输入消息/)
    await user.type(composer, 'hello agent')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      prompt: 'hello agent',
      modelId: 'mock/hesper-fast',
      workspacePath: 'C:/workspace'
    }))
    const enqueueInput = (enqueue as any).mock.calls[0]?.[0] as { messageId?: string; messageCreatedAt?: string } | undefined
    expect(enqueueInput?.messageId).toEqual(expect.any(String))
    expect(enqueueInput?.messageCreatedAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/))
    expect(await screen.findByText('hello agent')).toBeInTheDocument()

    runtimeListener?.({
      type: 'run.created',
      run: {
        id: 'run-1',
        sessionId: 'session-1',
        status: 'running',
        modelId: 'mock/hesper-fast',
        workspacePath: 'C:/workspace',
        retryCount: 0,
        maxRetries: 5
      }
    })
    runtimeListener?.({ type: 'message.delta', runId: 'run-1', delta: 'hello ' })
    runtimeListener?.({ type: 'message.delta', runId: 'run-1', delta: 'world' })

    expect(await screen.findByText('hello world')).toBeInTheDocument()

    runtimeListener?.({
      type: 'message.completed',
      message: {
        id: 'message-assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: 'hello world',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: '2026-06-10T03:00:10.000Z'
      }
    })

    await waitFor(() => {
      expect(screen.getAllByText('hello world')).toHaveLength(1)
    })
  })

  it('uses a configured provider model instead of the mock fallback when sending from an existing mock session', async () => {
    const user = userEvent.setup()

    listProviders.mockResolvedValueOnce([
      { id: 'mock', name: 'Mock', kind: 'mock', enabled: true, hasApiKey: false, defaultModelId: 'mock/hesper-fast', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
      { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', enabled: true, hasApiKey: true, defaultModelId: 'deepseek-chat', createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    listModels.mockResolvedValueOnce([
      { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
      { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
    ] as any)
    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Configured chat',
        status: 'active',
        workspacePath: 'C:/workspace',
        defaultModelId: 'mock/hesper-fast',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)

    render(<App />)

    expect(await screen.findByRole('button', { name: '选择模型' })).toHaveTextContent('DeepSeek/deepseek-chat')
    await user.type(screen.getByPlaceholderText(/输入消息/), 'use configured model')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      prompt: 'use configured model',
      modelId: 'deepseek-chat'
    }))
  })

  it('removes optimistic user message and shows an error when enqueue fails', async () => {
    const user = userEvent.setup()

    listSessions.mockResolvedValueOnce([
      {
        id: 'session-1',
        title: 'Task 11',
        status: 'active',
        workspacePath: 'C:/workspace',
        defaultModelId: 'mock/hesper-fast',
        outputMode: 'markdown',
        createdAt: '2026-06-10T03:00:00.000Z',
        updatedAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    enqueue.mockRejectedValueOnce(new Error('enqueue failed'))

    render(<App />)

    const composer = await screen.findByPlaceholderText(/输入消息/)
    await user.type(composer, 'will fail')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('发送失败：enqueue failed')
    await waitFor(() => {
      expect(screen.queryByText('will fail')).not.toBeInTheDocument()
    })
  })
})
