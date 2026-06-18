// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, clearSessionSendError, pruneSessionSendErrors } from '../src/App'

const { listSessions, createSession, updateTitle, deleteSession, generateTitle, listMessages, listRuns, listSteps, enqueue, onEvent, listProviders, listModels, minimizeWindow, toggleMaximizeWindow, closeWindow } = vi.hoisted(() => ({
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
  generateTitle: vi.fn(async (input: { id: string; modelId: string; userPrompt: string; assistantResponse: string }) => ({
    id: input.id,
    title: '模型生成标题',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:12.000Z'
  })),
  listMessages: vi.fn(async (_sessionId?: string) => []),
  listRuns: vi.fn(async (_sessionId?: string) => []),
  listSteps: vi.fn(async (_runId?: string) => []),
  enqueue: vi.fn(async () => ({ runId: 'run-1' })),
  onEvent: vi.fn(() => () => undefined),
  listProviders: vi.fn(async () => []),
  listModels: vi.fn(async () => []),
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
      generateTitle
    },
    conversation: { listMessages, listRuns, listSteps },
    agent: { enqueue, onEvent },
    dialog: { selectDirectory: vi.fn() },
    providers: { list: listProviders },
    models: { list: listModels },
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
    listMessages.mockReset()
    listRuns.mockReset()
    listSteps.mockReset()
    enqueue.mockReset()
    onEvent.mockReset()
    listProviders.mockReset()
    listModels.mockReset()
    minimizeWindow.mockClear()
    toggleMaximizeWindow.mockClear()
    closeWindow.mockClear()
    listSessions.mockResolvedValue([])
    listMessages.mockResolvedValue([])
    listRuns.mockResolvedValue([])
    listSteps.mockResolvedValue([])
    listProviders.mockResolvedValue([])
    listModels.mockResolvedValue([])
    enqueue.mockResolvedValue({ runId: 'run-1' })
    onEvent.mockImplementation(() => () => undefined)
  })

  it('renders the high-density shell, native titlebar controls, and empty conversation state', async () => {
    const user = userEvent.setup()

    render(<App />)

    expect((await screen.findAllByText('hesper')).length).toBeGreaterThan(0)
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
        assistantResponse: '最近一次 Agent 回答'
      })
    })
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
        assistantResponse: '可以，标题、分镜、旁白和镜头节奏可以这样安排。'
      })
    })
    expect(await screen.findAllByText('模型生成标题')).not.toHaveLength(0)
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
