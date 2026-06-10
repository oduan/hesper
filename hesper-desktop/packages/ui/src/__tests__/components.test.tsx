import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'

const now = '2026-06-10T03:00:00.000Z'

describe('ui components', () => {
  it('renders high-density desktop shell rails and panes', () => {
    render(<AppShell sessions={[]} activeSection="sessions" title="构建 hesper MVP" />)
    expect(screen.getByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
  })

  it('disables send button when composer is empty and enables it with text', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('renders output blocks with expand control', () => {
    render(<OutputBlock content="hello" contentType="markdown" />)
    expect(screen.getByRole('button', { name: '全屏查看输出' })).toBeInTheDocument()
  })

  it('renders run step states', () => {
    render(
      <RunSteps
        steps={[
          { id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now }
        ]}
      />
    )
    expect(screen.getByText('Thinking')).toBeInTheDocument()
  })
})
