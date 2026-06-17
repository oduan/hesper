// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationView, type ConversationShortcutCommand } from '@hesper/ui'

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

    expect(onSend).toHaveBeenCalledWith('hello')
    expect(screen.getByPlaceholderText(/输入消息/)).toHaveValue('')
  })

  it('renders top output selector and opens fullscreen output', async () => {
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
    const outputModeButton = screen.getByRole('button', { name: '选择输出模式' })
    expect(outputModeButton).toHaveTextContent('markdown')
    expect(screen.queryByText('输出')).not.toBeInTheDocument()

    await user.click(outputModeButton)
    expect(screen.getByRole('listbox', { name: '选择输出模式选项' })).toHaveStyle({ display: 'grid' })
    await user.click(outputModeButton)

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



  it('renders reasoning steps under the user message that started each run', () => {
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
    const firstReasoning = screen.getByText('First reasoning')
    const firstAnswer = screen.getByText('first answer')
    const secondPrompt = screen.getByText('second prompt')
    const secondReasoning = screen.getByText('Second reasoning')
    const secondAnswer = screen.getByText('second answer')

    expect(firstPrompt.compareDocumentPosition(firstReasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(firstReasoning.compareDocumentPosition(firstAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(secondPrompt.compareDocumentPosition(secondReasoning) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(secondReasoning.compareDocumentPosition(secondAnswer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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
})
