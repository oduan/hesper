// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, clearSessionSendError, pruneSessionSendErrors } from '../src/App'

const { listSessions, createSession, enqueue, onEvent } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  createSession: vi.fn(async () => ({
    id: 'session-1',
    title: 'New chat',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  })),
  enqueue: vi.fn(async () => ({ runId: 'run-1' })),
  onEvent: vi.fn(() => () => undefined)
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: createSession
    },
    agent: { enqueue, onEvent },
    dialog: { selectDirectory: vi.fn() }
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
  })

  beforeEach(() => {
    listSessions.mockReset()
    createSession.mockClear()
    enqueue.mockReset()
    onEvent.mockReset()
    listSessions.mockResolvedValue([])
    enqueue.mockResolvedValue({ runId: 'run-1' })
    onEvent.mockImplementation(() => () => undefined)
  })

  it('renders the high-density shell and empty conversation state', async () => {
    render(<App />)
    expect(await screen.findByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })

  it('creates a session from the activity rail new-session button', async () => {
    const user = userEvent.setup()

    render(<App />)

    const newSessionButtons = await screen.findAllByRole('button', { name: '新建会话' })
    await user.click(newSessionButtons[0]!)

    expect(createSession).toHaveBeenCalledWith({ title: 'New chat' })
    expect(await screen.findAllByText('New chat')).not.toHaveLength(0)
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
    expect(screen.getByRole('region', { name: 'Tools 即将支持 占位区域' })).toBeInTheDocument()
  })

  it('shows a minimal error state when initial sessions load fails', async () => {
    listSessions.mockRejectedValueOnce(new Error('IPC unavailable'))

    render(<App />)

    expect(await screen.findByRole('alert')).toHaveTextContent('会话加载失败：IPC unavailable')
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
    const enqueueInput = (enqueue as any).mock.calls[0]?.[0] as { messageId?: string } | undefined
    expect(enqueueInput?.messageId).toEqual(expect.any(String))
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
