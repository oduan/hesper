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

const { listSessions, setWorkspace, setModel, setOutputMode, selectDirectory, onEvent, enqueue } = vi.hoisted(() => ({
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
  enqueue: vi.fn(async () => ({ runId: 'run-1' }))
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
      onEvent,
      subscribe: vi.fn()
    },
    settings: {
      get: vi.fn(),
      update: vi.fn()
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
    onEvent.mockImplementation(() => () => undefined)
    enqueue.mockResolvedValue({ runId: 'run-1' })
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

  it('shows tools, skills and roles placeholders for future extension points', async () => {
    listSessions.mockResolvedValueOnce([createSession()] as any)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })
    expect(screen.getByText(/Tools/i)).toBeInTheDocument()
    expect(screen.getByText(/Skills/i)).toBeInTheDocument()
    expect(screen.getByText(/Roles/i)).toBeInTheDocument()
  })

  it('persists workspace, model and output mode changes and refreshes session list details', async () => {
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

    await user.selectOptions(screen.getByRole('combobox', { name: '选择模型' }), 'openai/gpt-4o')
    await waitFor(() => {
      expect(setModel).toHaveBeenCalledWith({ id: 'session-1', defaultModelId: 'openai/gpt-4o' })
    })
    expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveValue('openai/gpt-4o')
    expect(screen.getByRole('button', { name: /Current chat/ })).toHaveTextContent('openai/gpt-4o')

    await user.selectOptions(screen.getByRole('combobox', { name: '选择输出模式' }), 'html')
    await waitFor(() => {
      expect(setOutputMode).toHaveBeenCalledWith({ id: 'session-1', outputMode: 'html' })
    })
    expect(screen.getAllByText('html').length).toBeGreaterThan(0)
  })

  it('uses the newly selected model immediately when the session update is still in flight', async () => {
    const user = userEvent.setup()
    const deferred = createDeferred<any>()
    listSessions.mockResolvedValueOnce([createSession()] as any)
    setModel.mockImplementationOnce(() => deferred.promise)

    render(<App />)

    await screen.findByRole('heading', { name: 'Current chat' })

    await user.selectOptions(screen.getByRole('combobox', { name: '选择模型' }), 'openai/gpt-4o')
    await user.type(screen.getByPlaceholderText(/输入消息/), 'send with new model')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'openai/gpt-4o'
    }))

    deferred.resolve(createSession({ defaultModelId: 'openai/gpt-4o', updatedAt: '2026-06-10T03:06:00.000Z' }))
    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '选择模型' })).toHaveValue('openai/gpt-4o')
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
})
