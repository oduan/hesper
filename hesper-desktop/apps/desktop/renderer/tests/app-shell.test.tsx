// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App, clearSessionSendError, pruneSessionSendErrors } from '../src/App'

const { listSessions, createSession, updateTitle, deleteSession, generateTitle, markViewed, listMessages, listRuns, listSteps, enqueue, onEvent, getSettings, updateSettings, listProviders, listModels, listTools, setToolEnabled, minimizeWindow, toggleMaximizeWindow, closeWindow } = vi.hoisted(() => ({
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
  listMessages: vi.fn(async (_sessionId?: string) => []),
  listRuns: vi.fn(async (_sessionId?: string) => []),
  listSteps: vi.fn(async (_runId?: string) => []),
  enqueue: vi.fn(async () => ({ runId: 'run-1' })),
  onEvent: vi.fn(() => () => undefined),
  getSettings: vi.fn(async () => ({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14 })),
  updateSettings: vi.fn(async (input: Partial<{ defaultModelId: string; defaultOutputMode: 'markdown' | 'html'; themeMode: 'system' | 'light' | 'dark'; fontSize: number }>) => ({
    defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
    defaultOutputMode: input.defaultOutputMode ?? 'markdown',
    themeMode: input.themeMode ?? 'dark',
    fontSize: input.fontSize ?? 14
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
      description: 'Fetch and extract text from a URL.',
      category: 'web',
      inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
      enabled: false
    }
  ]),
  setToolEnabled: vi.fn(async (input: { id: string; enabled: boolean }) => ({
    id: input.id,
    name: input.id === 'web.fetch-url' ? 'Fetch URL' : 'Read File',
    description: input.id === 'web.fetch-url' ? 'Fetch and extract text from a URL.' : 'Read a text file from the selected workspace.',
    category: input.id === 'web.fetch-url' ? 'web' : 'filesystem',
    inputSchema: input.id === 'web.fetch-url'
      ? { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
      : { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
    enabled: input.enabled
  })),
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
    conversation: { listMessages, listRuns, listSteps },
    agent: { enqueue, onEvent },
    dialog: { selectDirectory: vi.fn() },
    settings: { get: getSettings, update: updateSettings },
    providers: { list: listProviders },
    models: { list: listModels },
    tools: { list: listTools, setEnabled: setToolEnabled },
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
    listMessages.mockReset()
    listRuns.mockReset()
    listSteps.mockReset()
    enqueue.mockReset()
    onEvent.mockReset()
    getSettings.mockReset()
    updateSettings.mockReset()
    listProviders.mockReset()
    listModels.mockReset()
    listTools.mockReset()
    setToolEnabled.mockClear()
    minimizeWindow.mockClear()
    toggleMaximizeWindow.mockClear()
    closeWindow.mockClear()
    listSessions.mockResolvedValue([])
    listMessages.mockResolvedValue([])
    listRuns.mockResolvedValue([])
    listSteps.mockResolvedValue([])
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
        description: 'Fetch and extract text from a URL.',
        category: 'web',
        inputSchema: { type: 'object', required: ['url'], properties: { url: { type: 'string' } } },
        enabled: false
      }
    ])
    setToolEnabled.mockImplementation(async (input: { id: string; enabled: boolean }) => ({
      id: input.id,
      name: input.id === 'web.fetch-url' ? 'Fetch URL' : 'Read File',
      description: input.id === 'web.fetch-url' ? 'Fetch and extract text from a URL.' : 'Read a text file from the selected workspace.',
      category: input.id === 'web.fetch-url' ? 'web' : 'filesystem',
      inputSchema: input.id === 'web.fetch-url'
        ? { type: 'object', required: ['url'], properties: { url: { type: 'string' } } }
        : { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
      enabled: input.enabled
    }))
    enqueue.mockResolvedValue({ runId: 'run-1' })
    onEvent.mockImplementation(() => () => undefined)
    markViewed.mockImplementation(async (id: string) => ({
      id,
      title: id === 'session-bg' ? '后台会话' : '当前会话',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:00.000Z'
    }))
    getSettings.mockResolvedValue({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', fontSize: 14 })
    updateSettings.mockImplementation(async (input) => ({
      defaultModelId: input.defaultModelId ?? 'mock/hesper-fast',
      defaultOutputMode: input.defaultOutputMode ?? 'markdown',
      themeMode: input.themeMode ?? 'dark',
      fontSize: input.fontSize ?? 14
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

    await user.click(screen.getByText('Fetch URL').closest('[role="button"]') as HTMLElement)
    expect(screen.getByRole('region', { name: '工具详情' })).toHaveTextContent('Fetch URL')
    const detailSwitch = screen.getByRole('switch', { name: '工具全局开关' })
    expect(detailSwitch).toHaveAttribute('aria-checked', 'false')
    expect(detailSwitch.querySelector('[data-tool-toggle-track="true"]')).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)' })
    expect(detailSwitch.querySelector('[data-tool-toggle-knob="true"]')).toHaveStyle({ transform: 'translateX(0)' })
    await user.click(detailSwitch)
    expect(setToolEnabled).toHaveBeenCalledWith({ id: 'web.fetch-url', enabled: true })
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

    await waitFor(() => expect(backgroundRow.querySelector('[data-session-unread-icon="new-message"]')).toBeInTheDocument())
    expect(markViewed).not.toHaveBeenCalledWith('session-bg')

    await user.click(backgroundRow)
    await waitFor(() => expect(markViewed).toHaveBeenCalledWith('session-bg'))
    await waitFor(() => expect(backgroundRow.querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument())
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
    let storedSettings: { defaultModelId: string; defaultOutputMode: 'markdown' | 'html'; themeMode: 'system' | 'light' | 'dark'; fontSize: number } = {
      defaultModelId: 'mock/hesper-fast',
      defaultOutputMode: 'markdown',
      themeMode: 'dark',
      fontSize: 14
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
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb')).toBe('rgba(192, 202, 245, 0.18)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-hover')).toBe('rgba(192, 202, 245, 0.34)')

    await user.click(screen.getByRole('button', { name: /^亮色/ }))
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ themeMode: 'light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    expect(appRoot?.style.getPropertyValue('--hesper-color-background')).toBe('#dce0e8')
    expect(appRoot?.style.getPropertyValue('--hesper-color-accent')).toBe('#8839ef')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb')).toBe('rgba(76, 79, 105, 0.18)')
    expect(appRoot?.style.getPropertyValue('--hesper-color-scrollbar-thumb-hover')).toBe('rgba(76, 79, 105, 0.34)')

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
    updateTitle.mockImplementationOnce((input: { id: string; title: string }) => new Promise((resolve) => {
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
