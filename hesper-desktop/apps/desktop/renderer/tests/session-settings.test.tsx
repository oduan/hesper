// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

function createSession(overrides: Partial<any> = {}) {
  return {
    id: 'session-1',
    title: 'Current chat',
    status: 'active',
    workspacePath: 'C:/workspace',
    defaultModelId: 'mock/hesper-fast',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z',
    ...overrides
  }
}

async function chooseThemedOption(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('button', { name: label }))
  await user.click(await screen.findByRole('option', { name: option }))
}

const { listSessions, setWorkspace, setModel, setOutputMode, selectDirectory, onEvent, enqueue, stopRun, getSettings, updateSettings, listModels, listTools, setToolEnabled, listSkills, refreshSkills, listRoles } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  setWorkspace: vi.fn(async (input: { id: string; workspacePath?: string }) =>
    createSession({ id: input.id, workspacePath: input.workspacePath, updatedAt: '2026-06-10T03:05:00.000Z' })
  ),
  setModel: vi.fn(async (input: { id: string; defaultModelId?: string }) =>
    createSession({ id: input.id, defaultModelId: input.defaultModelId, updatedAt: '2026-06-10T03:06:00.000Z' })
  ),
  setOutputMode: vi.fn(async (input: { id: string; outputMode: 'markdown' | 'html' }) =>
    createSession({ id: input.id, outputMode: input.outputMode, updatedAt: '2026-06-10T03:07:00.000Z' })
  ),
  selectDirectory: vi.fn(async () => ({ canceled: false, path: 'D:/updated-workspace' })),
  onEvent: vi.fn(() => () => undefined),
  enqueue: vi.fn(async () => ({ runId: 'run-1' })),
  stopRun: vi.fn(async () => undefined),
  getSettings: vi.fn(async () => ({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14 })),
  updateSettings: vi.fn(async (input: Partial<{ defaultModelId: string; defaultOutputMode: 'markdown' | 'html'; themeMode: 'system' | 'light' | 'dark'; fontSize: number }>) => ({
    defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
    defaultOutputMode: input.defaultOutputMode ?? 'markdown',
    themeMode: input.themeMode ?? 'dark',
    fontSize: input.fontSize ?? 14
  })),
  listModels: vi.fn(async () => [
    { id: 'mock/hesper-fast', providerId: 'mock', modelName: 'mock/hesper-fast', displayName: 'Hesper Mock Fast', capabilities: ['streaming'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
    { id: 'gpt-4o', providerId: 'openai', modelName: 'gpt-4o', displayName: 'GPT-4o', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' },
    { id: 'deepseek-chat', providerId: 'deepseek', modelName: 'deepseek-chat', displayName: 'DeepSeek Chat', capabilities: ['streaming', 'toolCalls'], enabled: true, createdAt: '2026-06-10T03:00:00.000Z', updatedAt: '2026-06-10T03:00:00.000Z' }
  ]),
  listTools: vi.fn(async () => [
    {
      id: 'filesystem.read-file',
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      enabled: true
    }
  ]),
  setToolEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
    id: input.id,
    name: 'Read File',
    description: 'Read a text file from the selected workspace.',
    category: 'filesystem',
    inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    enabled: input.enabled
  })),
  listSkills: vi.fn(async (): Promise<any[]> => []),
  refreshSkills: vi.fn(async (): Promise<any[]> => []),
  listRoles: vi.fn(async () => [])
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: vi.fn(),
      updateTitle: vi.fn(),
      archive: vi.fn(),
      delete: vi.fn(),
      setWorkspace,
      setModel,
      setOutputMode
    },
    dialog: { selectDirectory },
    agent: {
      enqueue,
      stop: stopRun,
      onEvent,
      subscribe: vi.fn()
    },
    settings: {
      get: getSettings,
      update: updateSettings
    },
    models: {
      list: listModels,
      save: vi.fn()
    },
    tools: {
      list: listTools,
      setEnabled: setToolEnabled
    },
    skills: {
      list: listSkills,
      get: vi.fn(),
      refresh: refreshSkills
    },
    roles: {
      list: listRoles,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn()
    },
    window: {
      platform: 'win32',
      minimize: vi.fn(async () => ({ minimized: true })),
      toggleMaximize: vi.fn(async () => ({ isMaximized: true })),
      close: vi.fn(async () => ({ closed: true }))
    }
  }
}))

describe('session settings and restore flow', () => {
  afterEach(() => {
    cleanup()
  })

  beforeEach(() => {
    listSessions.mockReset()
    setWorkspace.mockClear()
    setModel.mockClear()
    setOutputMode.mockClear()
    selectDirectory.mockClear()
    onEvent.mockReset()
    enqueue.mockReset()
    stopRun.mockReset()
    getSettings.mockReset()
    updateSettings.mockReset()
    listModels.mockClear()
    listTools.mockClear()
    setToolEnabled.mockClear()
    listSkills.mockReset()
    refreshSkills.mockReset()
    listRoles.mockReset()
    onEvent.mockImplementation(() => () => undefined)
    listSkills.mockResolvedValue([])
    refreshSkills.mockResolvedValue([])
    listRoles.mockResolvedValue([])
    enqueue.mockResolvedValue({ runId: 'run-1' })
    stopRun.mockResolvedValue(undefined)
    getSettings.mockResolvedValue({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14 })
    updateSettings.mockImplementation(async (input) => ({
      defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
      defaultOutputMode: input.defaultOutputMode ?? 'markdown',
      themeMode: input.themeMode ?? 'dark',
      fontSize: input.fontSize ?? 14
    }))
    listTools.mockResolvedValue([
      {
        id: 'filesystem.read-file',
        name: 'Read File',
        description: 'Read a text file from the selected workspace.',
        category: 'filesystem',
        inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
        enabled: true
      }
    ])
    setToolEnabled.mockImplementation(async (input: { id: string; enabled: boolean }) => ({
      id: input.id,
      name: 'Read File',
      description: 'Read a text file from the selected workspace.',
      category: 'filesystem',
      inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      enabled: input.enabled
    }))
  })

  it('restores the most recent active session instead of a newer archived session', async () => {
    listSessions.mockResolvedValueOnce([
      createSession({
        id: 'session-archived',
        title: 'Archived newer',
        status: 'archived',
        updatedAt: '2026-06-10T03:10:00.000Z'
      }),
      createSession({
        id: 'session-active',
        title: 'Active current',
        status: 'active',
        workspacePath: 'C:/active',
        updatedAt: '2026-06-10T03:09:00.000Z'
      })
    ] as any)

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Active current' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '选择工作目录' })).toHaveTextContent('C:/active')
  })

  it('shows tools page, renders skills management, and renders roles management from the activity rail', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    refreshSkills.mockResolvedValueOnce([
      { id: 'builtin:install-skills', name: '安装技能', description: '安装可复用技能', source: 'builtin', prompt: '安装说明' },
      { id: 'workspace:writer', name: '写作助手', source: 'workspace', prompt: '写作说明' }
    ])

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })

    await user.click(screen.getByRole('button', { name: '工具' }))
    expect(await screen.findByLabelText('工具列表')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '工具详情' })).toHaveTextContent('Read File')

    await user.click(screen.getByRole('button', { name: '技能' }))
    expect(await screen.findByLabelText('技能列表')).toBeInTheDocument()
    expect(refreshSkills).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('region', { name: '技能详情' })).toHaveTextContent('安装技能')
    expect(screen.getByRole('region', { name: '技能说明' })).toHaveTextContent('安装说明')
    await user.click(screen.getByRole('button', { name: '写作助手 暂无简介' }))
    expect(screen.getByRole('region', { name: '技能详情' })).toHaveTextContent('写作助手')

    await user.click(screen.getByRole('button', { name: '角色' }))
    expect(screen.queryByText('Roles 即将支持')).not.toBeInTheDocument()
    expect(screen.getByText('请让 Agent 创建角色后，再在这里维护名称、简介、提示词和默认工具。')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '创建第一个角色' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()
  })

  it('persists workspace and model changes, with output mode switching removed', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([createSession()] as any)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })

    await user.click(screen.getByRole('button', { name: '选择工作目录' }))
    expect(selectDirectory).toHaveBeenCalledTimes(1)
    await waitFor(() => {
      expect(setWorkspace).toHaveBeenCalledWith({ id: 'session-1', workspacePath: 'D:/updated-workspace' })
    })
    expect(screen.getByRole('button', { name: '选择工作目录' })).toHaveTextContent('D:/updated-workspace')

    await chooseThemedOption(user, '选择模型', 'gpt-4o')
    await waitFor(() => {
      expect(setModel).toHaveBeenCalledWith({ id: 'session-1', defaultModelId: 'gpt-4o' })
    })
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('gpt-4o')
    const sessionRow = screen.getByRole('button', { name: 'Current chat' })
    expect(sessionRow).toHaveTextContent('Current chat')
    expect(sessionRow).not.toHaveTextContent('gpt-4o')

    expect(screen.queryByRole('button', { name: '选择输出模式' })).not.toBeInTheDocument()
    expect(setOutputMode).not.toHaveBeenCalled()
  })

  it('uses the newly selected model immediately when the session update is still in flight', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    setModel.mockImplementationOnce(() => deferred.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })

    await chooseThemedOption(user, '选择模型', 'gpt-4o')
    await user.type(screen.getByPlaceholderText(/输入消息/), 'send with new model')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'gpt-4o'
    }))

    deferred.resolve(createSession({ defaultModelId: 'gpt-4o', updatedAt: '2026-06-10T03:06:00.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('gpt-4o')
    })
  })

  it('uses the newly selected workspace immediately when the session update is still in flight', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    setWorkspace.mockImplementationOnce(() => deferred.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })

    await user.click(screen.getByRole('button', { name: '选择工作目录' }))
    await user.type(screen.getByPlaceholderText(/输入消息/), 'send with new workspace')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      workspacePath: 'D:/updated-workspace'
    }))

    deferred.resolve(createSession({ workspacePath: 'D:/updated-workspace', updatedAt: '2026-06-10T03:05:00.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择工作目录' })).toHaveTextContent('D:/updated-workspace')
    })
  })

  it('keeps send errors isolated to the active session', async () => {
    const user = userEvent.setup()
    listSessions.mockResolvedValueOnce([
      createSession({ id: 'session-a', title: 'Session A', updatedAt: '2026-06-10T03:02:00.000Z' }),
      createSession({ id: 'session-b', title: 'Session B', updatedAt: '2026-06-10T03:01:00.000Z' })
    ] as any)
    enqueue.mockRejectedValueOnce(new Error('session-a failed'))

    render(<App />)

    await screen.findByRole('heading', { name: 'Session A' })
    await user.type(screen.getByPlaceholderText(/输入消息/), 'fail in A')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('发送失败：session-a failed')

    await user.click(screen.getByRole('button', { name: /Session B/ }))
    expect(await screen.findByRole('heading', { name: 'Session B' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('ignores stale model responses when two updates complete out of order', async () => {
    const user = userEvent.setup()
    const first = createDeferred<any>()
    const second = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    setModel.mockImplementationOnce(() => first.promise)
    setModel.mockImplementationOnce(() => second.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })
    await chooseThemedOption(user, '选择模型', 'deepseek-chat')
    await chooseThemedOption(user, '选择模型', 'gpt-4o')

    second.resolve(createSession({ defaultModelId: 'gpt-4o', updatedAt: '2026-06-10T03:06:02.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('gpt-4o')
    })

    first.resolve(createSession({ defaultModelId: 'deepseek-chat', updatedAt: '2026-06-10T03:06:01.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('gpt-4o')
    })

    await user.type(screen.getByPlaceholderText(/输入消息/), 'use latest model')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ modelId: 'gpt-4o' }))
  })

  it('ignores stale workspace responses when two updates complete out of order', async () => {
    const user = userEvent.setup()
    const first = createDeferred<any>()
    const second = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    selectDirectory.mockResolvedValueOnce({ canceled: false, path: 'D:/workspace-one' })
    selectDirectory.mockResolvedValueOnce({ canceled: false, path: 'E:/workspace-two' })
    setWorkspace.mockImplementationOnce(() => first.promise)
    setWorkspace.mockImplementationOnce(() => second.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })
    await user.click(screen.getByRole('button', { name: '选择工作目录' }))
    await user.click(screen.getByRole('button', { name: '选择工作目录' }))

    second.resolve(createSession({ workspacePath: 'E:/workspace-two', updatedAt: '2026-06-10T03:05:02.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择工作目录' })).toHaveTextContent('E:/workspace-two')
    })

    first.resolve(createSession({ workspacePath: 'D:/workspace-one', updatedAt: '2026-06-10T03:05:01.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择工作目录' })).toHaveTextContent('E:/workspace-two')
    })

    await user.type(screen.getByPlaceholderText(/输入消息/), 'use latest workspace')
    await user.click(screen.getByRole('button', { name: '发送' }))
    expect(enqueue).toHaveBeenLastCalledWith(expect.objectContaining({ workspacePath: 'E:/workspace-two' }))
  })

  it('does not expose output mode switching from the chat header', async () => {
    listSessions.mockResolvedValueOnce([createSession()] as any)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })
    expect(screen.queryByRole('button', { name: '选择输出模式' })).not.toBeInTheDocument()
    expect(setOutputMode).not.toHaveBeenCalled()
  })

  it('reverts model pending state when the latest request fails', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    setModel.mockImplementationOnce(() => deferred.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })
    await chooseThemedOption(user, '选择模型', 'gpt-4o')
    expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('gpt-4o')

    deferred.reject(new Error('save failed'))
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '选择模型' })).toHaveTextContent('mock/hesper-fast')
    })
  })
})
