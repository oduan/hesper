// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
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

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  scrollIntoViewMock = vi.fn()
  HTMLElement.prototype.scrollIntoView = scrollIntoViewMock as unknown as typeof HTMLElement.prototype.scrollIntoView
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

  it('opens right navigation and fullscreen output', async () => {
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

    await user.click(screen.getByRole('button', { name: '打开导航' }))
    expect(screen.getByText('会话导航')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
  })

  it('closes navigation and fullscreen when close-panels command arrives', async () => {
    const user = userEvent.setup()
    const { rerender } = renderConversation()

    await user.click(screen.getByRole('button', { name: '打开导航' }))
    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByText('会话导航')).toBeInTheDocument()
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

    expect(screen.queryByText('会话导航')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '输出全屏查看' })).not.toBeInTheDocument()
  })

  it('navigates to real step anchors from right navigation', async () => {
    const user = userEvent.setup()
    renderConversation()

    await user.click(screen.getByRole('button', { name: '打开导航' }))
    await user.click(screen.getByRole('button', { name: /工具节点\s+Searching repo/ }))

    const stepAnchor = document.getElementById('step-step-1')
    expect(stepAnchor).toBe(document.activeElement)
    expect(scrollIntoViewMock).toHaveBeenCalled()
  })
})
