// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationView, type ConversationShortcutCommand } from '@hesper/ui'
import { App } from '../src/App'

const { listSessions, listMessages, listRuns, listSteps, listWorkerInvocationsByParentRun, listMessagesByRun, enqueue, onEvent, markViewed } = vi.hoisted(() => ({
  listSessions: vi.fn(async () => []),
  listMessages: vi.fn(async (_sessionId?: string) => []),
  listRuns: vi.fn(async (_sessionId?: string) => []),
  listSteps: vi.fn(async (_runId?: string) => []),
  listWorkerInvocationsByParentRun: vi.fn(async (_input?: { sessionId: string; parentRunId: string }) => []),
  listMessagesByRun: vi.fn(async (_input?: { sessionId: string; runId: string }) => []),
  enqueue: vi.fn(async (_input?: unknown) => ({ runId: 'run-retry-new' })),
  onEvent: vi.fn(() => () => undefined),
  markViewed: vi.fn(async (id: string) => ({
    id,
    title: 'Retry session',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  }))
}))

vi.mock('../src/ipc-client', () => ({
  hesperApi: {
    sessions: {
      list: listSessions,
      create: vi.fn(),
      updateTitle: vi.fn(),
      delete: vi.fn(),
      generateTitle: vi.fn(),
      markViewed
    },
    conversation: { listMessages, listMessagesByRun, listRuns, listSteps },
    workerAgents: { listByParentRun: listWorkerInvocationsByParentRun },
    files: { preview: vi.fn() },
    agent: { enqueue, stop: vi.fn(), onEvent },
    dialog: { selectDirectory: vi.fn() },
    settings: { get: vi.fn(async () => ({ defaultModelId: 'mock/hesper-fast', defaultOutputMode: 'markdown', themeMode: 'dark', themeId: 'catppuccin', fontSize: 14, soul: '' })), update: vi.fn() },
    providers: { list: vi.fn(async () => []) },
    models: { list: vi.fn(async () => []) },
    tools: { list: vi.fn(async () => []), setEnabled: vi.fn(), credentialStatus: vi.fn(), saveApiKey: vi.fn(), deleteApiKey: vi.fn() },
    sshKeys: { list: vi.fn(async () => []), create: vi.fn(), delete: vi.fn() },
    sshServers: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    roles: { list: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    skills: { list: vi.fn(async () => []), refresh: vi.fn(async () => []) },
    window: { platform: 'win32', minimize: vi.fn(), toggleMaximize: vi.fn(), close: vi.fn() }
  }
}))

const session = {
  id: 'session-1',
  title: 'Test',
  status: 'active',
  outputMode: 'markdown',
  createdAt: '2026-06-10T03:00:00.000Z',
  updatedAt: '2026-06-10T03:00:00.000Z'
} as const

let scrollIntoViewMock: ReturnType<typeof vi.fn>
let scrollToMock: ReturnType<typeof vi.fn>

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

beforeEach(() => {
  scrollIntoViewMock = vi.fn()
  scrollToMock = vi.fn(function (this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === 'object' && typeof options.top === 'number') {
      this.scrollTop = options.top
    } else if (typeof options === 'number') {
      this.scrollTop = options
    }
  })
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof HTMLElement.prototype.scrollIntoView
  HTMLElement.prototype.scrollTo = scrollToMock as unknown as typeof HTMLElement.prototype.scrollTo

  listSessions.mockReset().mockResolvedValue([])
  listMessages.mockReset().mockResolvedValue([])
  listRuns.mockReset().mockResolvedValue([])
  listSteps.mockReset().mockResolvedValue([])
  listWorkerInvocationsByParentRun.mockReset().mockResolvedValue([])
  listMessagesByRun.mockReset().mockResolvedValue([])
  enqueue.mockReset().mockResolvedValue({ runId: 'run-retry-new' })
  onEvent.mockReset().mockReturnValue(() => undefined)
  markViewed.mockReset().mockImplementation(async (id: string) => ({
    id,
    title: 'Retry session',
    status: 'active',
    outputMode: 'markdown',
    createdAt: '2026-06-10T03:00:00.000Z',
    updatedAt: '2026-06-10T03:00:00.000Z'
  }))
})

function renderConversation(shortcutCommand?: ConversationShortcutCommand) {
  return render(
    <ConversationView
      session={session}
      messages={[
        {
          id: 'u1',
          sessionId: 'session-1',
          role: 'user',
          content: 'hello',
          contentType: 'plain',
          createdAt: '2026-06-10T03:00:00.000Z'
        },
        {
          id: 'a1',
          sessionId: 'session-1',
          role: 'assistant',
          content: 'final answer',
          contentType: 'markdown',
          createdAt: '2026-06-10T03:00:01.000Z'
        }
      ]}
      steps={[
        {
          id: 'step-1',
          runId: 'run-1',
          type: 'tool_call',
          status: 'running',
          title: 'Search Files',
          summary: 'Searching repo',
          createdAt: '2026-06-10T03:00:00.500Z'
        }
      ]}
      streamingText=""
      modelId="mock/hesper-fast"
      onSend={() => undefined}
      {...(shortcutCommand ? { shortcutCommand } : {})}
    />
  )
}

describe('ConversationView', () => {
  it('sends composer content and clears input', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    render(
      <ConversationView
        session={session}
        messages={[]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={onSend}
      />
    )

    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(onSend).toHaveBeenCalledWith('hello', expect.objectContaining({ thinkingLevel: 'high' }))
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue('')
  })

  it('renders without the top output mode selector and opens fullscreen output', async () => {
    const user = userEvent.setup()

    render(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'm1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'final answer',
            contentType: 'markdown',
            createdAt: '2026-06-10T03:00:00.000Z'
          }
        ]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    expect(screen.queryByRole('button', { name: '打开导航' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '选择输出模式' })).not.toBeInTheDocument()
    expect(screen.queryByRole('listbox', { name: '选择输出模式选项' })).not.toBeInTheDocument()
    expect(screen.queryByText('输出')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
  })

  it('shows a floating jump-to-bottom button when new content arrives while scrolled up', async () => {
    const user = userEvent.setup()
    const baseMessages = [
      {
        id: 'u1',
        sessionId: 'session-1',
        role: 'user' as const,
        content: 'hello',
        contentType: 'plain' as const,
        createdAt: '2026-06-10T03:00:00.000Z'
      }
    ]
    const { rerender } = render(
      <ConversationView
        session={session}
        messages={baseMessages}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )
    const messageList = screen.getByLabelText('消息列表')
    Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: 100 })
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 320 })
    messageList.scrollTop = 0
    fireEvent.scroll(messageList)

    expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument()

    rerender(
      <ConversationView
        session={session}
        messages={[
          ...baseMessages,
          {
            id: 'a1',
            sessionId: 'session-1',
            role: 'assistant' as const,
            content: 'new answer',
            contentType: 'markdown' as const,
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const jumpButton = await screen.findByRole('button', { name: '滚动到底部' })
    expect(jumpButton).toHaveStyle({ position: 'absolute', right: '16px', bottom: '16px' })
    expect(jumpButton.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()

    await user.click(jumpButton)
    expect(scrollToMock).toHaveBeenCalledWith(expect.objectContaining({ top: 320, behavior: 'smooth' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument())
  })

  it('keeps pinned conversations at the bottom for new content, streaming text, and resize growth', () => {
    let resizeObserverCallback: ResizeObserverCallback | undefined
    const originalResizeObserver = globalThis.ResizeObserver
    const resizeObserverMock = vi.fn().mockImplementation((callback: ResizeObserverCallback) => {
      resizeObserverCallback = callback
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn()
      }
    })
    globalThis.ResizeObserver = resizeObserverMock as unknown as typeof ResizeObserver

    try {
      const baseMessages = [
        {
          id: 'u1',
          sessionId: 'session-1',
          role: 'user' as const,
          content: 'hello',
          contentType: 'plain' as const,
          createdAt: '2026-06-10T03:00:00.000Z'
        }
      ]
      const { rerender } = render(
        <ConversationView
          session={session}
          messages={baseMessages}
          steps={[]}
          streamingText=""
          modelId="mock/hesper-fast"
          onSend={() => undefined}
        />
      )
      const messageList = screen.getByLabelText('消息列表')
      Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: 100 })
      Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 500 })
      messageList.scrollTop = 400
      fireEvent.scroll(messageList)

      scrollToMock.mockClear()
      Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 680 })
      const messagesWithAnswer = [
        ...baseMessages,
        {
          id: 'a1',
          sessionId: 'session-1',
          role: 'assistant' as const,
          content: 'new answer',
          contentType: 'markdown' as const,
          createdAt: '2026-06-10T03:00:01.000Z'
        }
      ]
      rerender(
        <ConversationView
          session={session}
          messages={messagesWithAnswer}
          steps={[]}
          streamingText=""
          modelId="mock/hesper-fast"
          onSend={() => undefined}
        />
      )
      expect(scrollToMock).toHaveBeenLastCalledWith(expect.objectContaining({ top: 680, behavior: 'auto' }))
      expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument()

      scrollToMock.mockClear()
      Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 760 })
      rerender(
        <ConversationView
          session={session}
          messages={messagesWithAnswer}
          steps={[]}
          streamingText="streaming update"
          modelId="mock/hesper-fast"
          onSend={() => undefined}
        />
      )
      expect(scrollToMock).toHaveBeenLastCalledWith(expect.objectContaining({ top: 760, behavior: 'auto' }))
      expect(screen.queryByRole('button', { name: '滚动到底部' })).not.toBeInTheDocument()

      scrollToMock.mockClear()
      Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: 920 })
      expect(resizeObserverCallback).toBeTypeOf('function')
      act(() => {
        resizeObserverCallback?.([], {} as ResizeObserver)
      })
      expect(scrollToMock).toHaveBeenLastCalledWith(expect.objectContaining({ top: 920, behavior: 'auto' }))
    } finally {
      if (originalResizeObserver) {
        globalThis.ResizeObserver = originalResizeObserver
      } else {
        Reflect.deleteProperty(globalThis, 'ResizeObserver')
      }
    }
  })

  it('renders messages in chronological order even when props arrive reversed', () => {
    render(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'a-late',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'later answer',
            contentType: 'markdown',
            createdAt: '2026-06-10T03:00:02.000Z'
          },
          {
            id: 'u-early',
            sessionId: 'session-1',
            role: 'user',
            content: 'first user prompt',
            contentType: 'plain',
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const userMessage = screen.getByText('first user prompt')
    const assistantMessage = screen.getByText('later answer')
    expect(userMessage.compareDocumentPosition(assistantMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('shows thought-only run steps as collapsed elapsed summaries without exposing reasoning text', () => {
    render(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'u1',
            sessionId: 'session-1',
            role: 'user',
            content: 'first prompt',
            contentType: 'plain',
            runId: 'run-1',
            createdAt: '2026-06-10T03:00:00.000Z'
          },
          {
            id: 'a1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'first answer',
            contentType: 'markdown',
            runId: 'run-1',
            createdAt: '2026-06-10T03:00:02.000Z'
          },
          {
            id: 'u2',
            sessionId: 'session-1',
            role: 'user',
            content: 'second prompt',
            contentType: 'plain',
            runId: 'run-2',
            createdAt: '2026-06-10T03:00:03.000Z'
          },
          {
            id: 'a2',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'second answer',
            contentType: 'markdown',
            runId: 'run-2',
            createdAt: '2026-06-10T03:00:05.000Z'
          }
        ]}
        steps={[]}
        stepsByRun={{
          'run-1': [
            {
              id: 'step-run-1',
              runId: 'run-1',
              type: 'thought',
              status: 'succeeded',
              title: 'First internal title',
              summary: 'First reasoning',
              createdAt: '2026-06-10T03:00:01.000Z'
            }
          ],
          'run-2': [
            {
              id: 'step-run-2',
              runId: 'run-2',
              type: 'thought',
              status: 'succeeded',
              title: 'Second internal title',
              summary: 'Second reasoning',
              createdAt: '2026-06-10T03:00:04.000Z'
            }
          ]
        }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const firstPrompt = screen.getByText('first prompt')
    const firstAnswer = screen.getByText('first answer')
    const secondPrompt = screen.getByText('second prompt')
    const secondAnswer = screen.getByText('second answer')

    expect(screen.queryByText('First reasoning')).not.toBeInTheDocument()
    expect(screen.queryByText('Second reasoning')).not.toBeInTheDocument()
    const stepRegions = screen.getAllByLabelText('步骤流')
    expect(stepRegions).toHaveLength(2)
    for (const region of stepRegions) {
      const toggle = within(region).getByRole('button', { expanded: false })
      expect(toggle).toHaveTextContent('1')
      expect(toggle).toHaveTextContent('2秒')
      expect(toggle).not.toHaveTextContent('First reasoning')
      expect(toggle).not.toHaveTextContent('Second reasoning')
    }
    expect(firstPrompt.compareDocumentPosition(firstAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(secondPrompt.compareDocumentPosition(secondAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('uses persisted run endedAt to restore completed elapsed timers after remounting', () => {
    render(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'u-restored',
            sessionId: 'session-1',
            role: 'user',
            content: 'restored prompt',
            contentType: 'plain',
            runId: 'run-restored',
            createdAt: '2026-06-10T03:00:00.000Z'
          },
          {
            id: 'a-restored',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'restored answer',
            contentType: 'markdown',
            runId: 'run-restored',
            createdAt: '2026-06-10T03:00:00.000Z'
          }
        ]}
        steps={[]}
        stepsByRun={{
          'run-restored': [
            {
              id: 'step-restored',
              runId: 'run-restored',
              type: 'thought',
              status: 'succeeded',
              title: 'Restored thought',
              summary: 'Restored reasoning',
              createdAt: '2026-06-10T03:00:01.000Z'
            }
          ]
        }}
        runsById={{
          'run-restored': {
            id: 'run-restored',
            sessionId: 'session-1',
            status: 'succeeded',
            modelId: 'mock/hesper-fast',
            retryCount: 0,
            maxRetries: 2,
            startedAt: '2026-06-10T03:00:00.000Z',
            endedAt: '2026-06-10T03:00:05.000Z'
          }
        }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    expect(within(screen.getByLabelText('步骤流')).getByRole('button', { expanded: false })).toHaveTextContent('5秒')
  })

  it('closes navigation and fullscreen when close-panels command arrives', async () => {
    const user = userEvent.setup()
    const { rerender } = renderConversation()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()

    rerender(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'u1',
            sessionId: 'session-1',
            role: 'user',
            content: 'hello',
            contentType: 'plain',
            createdAt: '2026-06-10T03:00:00.000Z'
          },
          {
            id: 'a1',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'final answer',
            contentType: 'markdown',
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ]}
        steps={[
          {
            id: 'step-1',
            runId: 'run-1',
            type: 'tool_call',
            status: 'running',
            title: 'Search Files',
            summary: 'Searching repo',
            createdAt: '2026-06-10T03:00:00.500Z'
          }
        ]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
        shortcutCommand={{ type: 'close-panels', nonce: 1 }}
      />
    )

    expect(screen.queryByRole('dialog', { name: '输出全屏查看' })).not.toBeInTheDocument()
  })

  it('shows retry only for failed user-message runs and disables it while a run is active', async () => {
    const user = userEvent.setup()
    const onRetryRun = vi.fn()

    render(
      <ConversationView
        session={session}
        messages={[
          {
            id: 'failed-user',
            sessionId: 'session-1',
            role: 'user',
            content: 'failed prompt',
            contentType: 'plain',
            runId: 'run-failed',
            createdAt: '2026-06-10T03:00:00.000Z'
          },
          {
            id: 'running-user',
            sessionId: 'session-1',
            role: 'user',
            content: 'running prompt',
            contentType: 'plain',
            runId: 'run-running',
            createdAt: '2026-06-10T03:00:02.000Z'
          },
          {
            id: 'succeeded-user',
            sessionId: 'session-1',
            role: 'user',
            content: 'succeeded prompt',
            contentType: 'plain',
            runId: 'run-succeeded',
            createdAt: '2026-06-10T03:00:04.000Z'
          },
          {
            id: 'succeeded-assistant',
            sessionId: 'session-1',
            role: 'assistant',
            content: 'done',
            contentType: 'markdown',
            runId: 'run-succeeded',
            createdAt: '2026-06-10T03:00:05.000Z'
          }
        ]}
        steps={[]}
        stepsByRun={{}}
        runsById={{
          'run-failed': {
            id: 'run-failed',
            sessionId: 'session-1',
            status: 'failed',
            modelId: 'mock/hesper-fast',
            retryCount: 2,
            maxRetries: 2,
            startedAt: '2026-06-10T03:00:00.000Z',
            endedAt: '2026-06-10T03:00:01.000Z',
            error: { code: 'stream_interrupted', message: 'stream disconnected', retryable: true }
          },
          'run-running': {
            id: 'run-running',
            sessionId: 'session-1',
            status: 'running',
            modelId: 'mock/hesper-fast',
            retryCount: 0,
            maxRetries: 2,
            startedAt: '2026-06-10T03:00:02.000Z'
          },
          'run-succeeded': {
            id: 'run-succeeded',
            sessionId: 'session-1',
            status: 'succeeded',
            modelId: 'mock/hesper-fast',
            retryCount: 0,
            maxRetries: 2,
            startedAt: '2026-06-10T03:00:04.000Z',
            endedAt: '2026-06-10T03:00:05.000Z'
          }
        }}
        streamingText=""
        modelId="mock/hesper-fast"
        running
        onSend={() => undefined}
        onRetryRun={onRetryRun}
      />
    )

    const retryButton = screen.getByRole('button', { name: '重试失败运行' })
    expect(retryButton).toBeDisabled()
    expect(screen.queryAllByRole('button', { name: '重试失败运行' })).toHaveLength(1)

    await user.click(retryButton)
    expect(onRetryRun).not.toHaveBeenCalled()
  })

  it('retries a failed App run by appending a new user message and run while preserving old history', async () => {
    const user = userEvent.setup()
    const retrySession = {
      id: 'session-retry',
      title: 'Retry session',
      status: 'active',
      outputMode: 'markdown',
      createdAt: '2026-06-10T03:00:00.000Z',
      updatedAt: '2026-06-10T03:00:10.000Z'
    }
    listSessions.mockResolvedValueOnce([retrySession] as any)
    listMessages.mockResolvedValueOnce([
      {
        id: 'old-user',
        sessionId: 'session-retry',
        role: 'user',
        content: 'retry this prompt',
        contentType: 'plain',
        runId: 'run-failed',
        createdAt: '2026-06-10T03:00:00.000Z'
      }
    ] as any)
    listRuns.mockResolvedValueOnce([
      {
        id: 'run-failed',
        sessionId: 'session-retry',
        status: 'failed',
        modelId: 'mock/hesper-fast',
        retryCount: 2,
        maxRetries: 2,
        startedAt: '2026-06-10T03:00:00.000Z',
        endedAt: '2026-06-10T03:00:05.000Z',
        error: { code: 'stream_interrupted', message: 'stream disconnected', retryable: true }
      }
    ] as any)
    listSteps.mockResolvedValueOnce([
      {
        id: 'failed-step',
        runId: 'run-failed',
        type: 'warning',
        status: 'failed',
        title: '运行失败：stream_interrupted',
        detail: 'stream disconnected',
        createdAt: '2026-06-10T03:00:05.000Z',
        completedAt: '2026-06-10T03:00:05.000Z'
      }
    ] as any)
    enqueue.mockResolvedValueOnce({ runId: 'run-retry-new' })

    render(<App />)

    expect(await screen.findByText('retry this prompt')).toBeInTheDocument()
    expect(await screen.findByText('运行失败：stream_interrupted')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '重试失败运行' }))

    await waitFor(() => expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-retry',
      prompt: 'retry this prompt',
      modelId: 'mock/hesper-fast'
    })))
    expect(screen.getAllByText('retry this prompt')).toHaveLength(2)
    expect(screen.getByText('运行失败：stream_interrupted')).toBeInTheDocument()
    expect(enqueue.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      messageId: expect.any(String),
      messageCreatedAt: expect.any(String)
    }))
  })
})
