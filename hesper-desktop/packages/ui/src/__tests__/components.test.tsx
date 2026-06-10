import '@testing-library/jest-dom/vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'

const now = '2026-06-10T03:00:00.000Z'

describe('ui components', () => {
  it('renders high-density desktop shell rails and panes', async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn()
    const onSelectSection = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="sessions"
        title="构建 hesper MVP"
        onCreateSession={onCreateSession}
        onSelectSection={onSelectSection}
      />
    )

    expect(screen.getByText('hesper')).toBeInTheDocument()
    expect(screen.getByText('所有会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '所有会话' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('功能栏')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('实体列表')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByText('构建 hesper MVP').closest('header')).toHaveClass('titlebar-drag')

    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '工具' }))
    expect(onSelectSection).toHaveBeenCalledWith('tools')
  })

  it('disables send button when composer is empty and enables it with text', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={() => undefined} />)
    expect(screen.getByRole('button', { name: '发送' })).toBeDisabled()
    await user.type(screen.getByPlaceholderText(/输入消息/), 'hello')
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })

  it('renders output blocks with CSP wrapped html and fullscreen dialog', async () => {
    const user = userEvent.setup()
    const html = '<img src="https://example.com/a.png"><style>body{color:red}</style><p>hello</p>'
    render(<OutputBlock content={html} contentType="html" />)

    const previewFrame = screen.getByTitle('HTML 输出预览')
    expect(previewFrame).toHaveAttribute('sandbox', '')
    expect(previewFrame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(previewFrame.getAttribute('srcdoc')).toContain("img-src data:")
    expect(previewFrame.getAttribute('srcdoc')).toContain("style-src 'unsafe-inline'")
    expect(screen.getByRole('button', { name: '全屏查看输出' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
    const fullscreenFrame = screen.getByTitle('HTML 输出')
    expect(fullscreenFrame).toHaveAttribute('sandbox', '')
    expect(fullscreenFrame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(fullscreenFrame.getAttribute('srcdoc')).toContain("img-src data:")
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
