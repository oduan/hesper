import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
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
    expect(screen.getByRole('button', { name: '所有会话' })).toHaveAttribute('aria-current', 'page')
  })

  it('disables send button when composer is empty and enables it with text', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('renders output blocks with expand control', async () => {
    const user = userEvent.setup()
    const html = '<p>hello</p>'
    render(<OutputBlock content={html} contentType="html" />)

    const previewFrame = screen.getByTitle('HTML 输出预览')
    expect(previewFrame).toHaveAttribute('sandbox', '')
    expect(previewFrame).toHaveAttribute('srcdoc', html)
    expect(screen.getByRole('button', { name: '全屏查看输出' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
    const fullscreenFrame = screen.getByTitle('HTML 输出')
    expect(fullscreenFrame).toHaveAttribute('sandbox', '')
    expect(fullscreenFrame).toHaveAttribute('srcdoc', html)
  })

  it('renders run step states', () => {
    render(
      <RunSteps
        steps={[
          { id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now },
          { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Search Files', createdAt: now },
          { id: 'step-3', runId: 'run-1', type: 'tool_result', status: 'succeeded', title: 'Search Results', createdAt: now },
          { id: 'step-4', runId: 'run-1', type: 'model_call', status: 'pending', title: 'Call Model', createdAt: now },
          { id: 'step-5', runId: 'run-1', type: 'warning', status: 'failed', title: 'Network Warning', createdAt: now }
        ]}
      />
    )

    const toggle = screen.getByRole('button', { name: /最新步骤/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('Search Files')).toBeInTheDocument()
    expect(screen.getByText('Search Results')).toBeInTheDocument()
    expect(screen.getByText('Call Model')).toBeInTheDocument()
    expect(screen.getByText('Network Warning')).toBeInTheDocument()

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(within(items[0]!).getByText('思考 / 成功')).toBeInTheDocument()
    expect(within(items[1]!).getByText('工具调用 / 运行中')).toBeInTheDocument()
    expect(within(items[2]!).getByText('工具结果 / 成功')).toBeInTheDocument()
    expect(within(items[3]!).getByText('模型调用 / 待处理')).toBeInTheDocument()
    expect(within(items[4]!).getByText('警告 / 失败')).toBeInTheDocument()
  })
})
