// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationView } from '@hesper/ui'

const session = {
  id: 'session-1',
  title: 'Test',
  status: 'active',
  outputMode: 'markdown',
  createdAt: '2026-06-10T03:00:00.000Z',
  updatedAt: '2026-06-10T03:00:00.000Z'
} as const

afterEach(() => {
  cleanup()
})

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
})
