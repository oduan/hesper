import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'

const now = '2026-06-10T03:00:00.000Z'

afterEach(() => {
  cleanup()
})

describe('ui components', () => {
  it('renders high-density desktop shell rails and panes', async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn()
    const onSelectSection = vi.fn()
    const onWindowMinimize = vi.fn()
    const onWindowToggleMaximize = vi.fn()
    const onWindowClose = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="sessions"
        title="构建 hesper MVP"
        onCreateSession={onCreateSession}
        onSelectSection={onSelectSection}
        onWindowMinimize={onWindowMinimize}
        onWindowToggleMaximize={onWindowToggleMaximize}
        onWindowClose={onWindowClose}
      />
    )

    expect(screen.getAllByText('hesper')).not.toHaveLength(0)
    expect(screen.getByText('所有会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '所有会话' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('功能栏')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('实体列表')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('窗口标题栏')).toHaveClass('titlebar-drag')

    await user.click(screen.getByRole('button', { name: '最小化窗口' }))
    await user.click(screen.getByRole('button', { name: '最大化窗口' }))
    await user.click(screen.getByRole('button', { name: '关闭窗口' }))
    expect(onWindowMinimize).toHaveBeenCalledTimes(1)
    expect(onWindowToggleMaximize).toHaveBeenCalledTimes(1)
    expect(onWindowClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '新建会话' }))
    expect(onCreateSession).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: '工具' }))
    expect(onSelectSection).toHaveBeenCalledWith('tools')
  })

  it('disables send button when composer is empty and keeps controls visually aligned', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={() => undefined} />)
    const textarea = screen.getByPlaceholderText(/输入消息/)
    const modelSelect = screen.getByRole('button', { name: '选择模型' })
    const sendButton = screen.getByRole('button', { name: '发送' })

    expect(sendButton).toBeDisabled()
    expect(screen.getByLabelText('消息输入区')).toHaveStyle({ borderRadius: '20px' })
    expect(textarea).toHaveStyle({ borderRadius: '0' })
    expect(textarea).toHaveClass('hesper-theme-scrollbar')
    expect(screen.queryByText('模型')).not.toBeInTheDocument()
    expect(modelSelect).toHaveStyle({ background: 'transparent', borderRadius: '0', padding: '0' })
    expect(sendButton).toHaveStyle({ fontSize: '22px', display: 'inline-flex' })

    await user.type(textarea, 'hello')
    expect(sendButton).toBeEnabled()
  })

  it('handles each external send signal only once', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const renderComposer = (sendSignal: number) => (
      <Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" outputMode="markdown" onSend={onSend} sendSignal={sendSignal} />
    )
    const { rerender } = render(renderComposer(0))
    const textarea = screen.getByPlaceholderText(/输入消息/)

    await user.type(textarea, 'first')
    rerender(renderComposer(1))

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('first'))
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(textarea).toHaveValue('')

    await user.type(textarea, 'second')
    expect(textarea).toHaveValue('second')
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('renders output blocks with CSP wrapped html, themed scrollbars and fullscreen dialog', async () => {
    const user = userEvent.setup()
    const html = '<img src="https://example.com/a.png"><style>body{color:red}</style><p>hello</p>'
    render(<OutputBlock content={html} contentType="html" />)

    const previewFrame = screen.getByTitle('HTML 输出预览')
    expect(previewFrame).toHaveAttribute('sandbox', '')
    expect(previewFrame.closest('.hesper-theme-scrollbar')).toBeInTheDocument()
    expect(previewFrame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(previewFrame.getAttribute('srcdoc')).toContain('img-src data:')
    expect(previewFrame.getAttribute('srcdoc')).toContain("style-src 'unsafe-inline'")
    expect(screen.getByRole('button', { name: '全屏查看输出' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    expect(screen.getByRole('dialog', { name: '输出全屏查看' })).toBeInTheDocument()
    const fullscreenFrame = screen.getByTitle('HTML 输出')
    expect(fullscreenFrame).toHaveAttribute('sandbox', '')
    expect(fullscreenFrame.closest('.hesper-theme-scrollbar')).toBeInTheDocument()
    expect(fullscreenFrame.getAttribute('srcdoc')).toContain("default-src 'none'")
    expect(fullscreenFrame.getAttribute('srcdoc')).toContain('img-src data:')
  })

  it('renders run steps as a collapsed latest-step row with aligned status dots', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        steps={[
          { id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Thinking', createdAt: now },
          { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Search Files', createdAt: '2026-06-10T03:00:01.000Z' },
          { id: 'step-3', runId: 'run-1', type: 'tool_result', status: 'succeeded', title: 'Search Results', createdAt: '2026-06-10T03:00:02.000Z' },
          { id: 'step-4', runId: 'run-1', type: 'model_call', status: 'pending', title: 'Call Model', createdAt: '2026-06-10T03:00:03.000Z' },
          { id: 'step-5', runId: 'run-1', type: 'warning', status: 'failed', title: 'Network Warning', createdAt: '2026-06-10T03:00:04.000Z' }
        ]}
      />
    )

    const toggle = screen.getByRole('button', { name: /最新步骤/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('5')
    expect(toggle).toHaveTextContent('Network Warning')
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument()
    expect(screen.queryByText('思考 / 成功')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Thinking')).toBeInTheDocument()
    expect(screen.getByText('Search Files')).toBeInTheDocument()
    expect(screen.getByText('Search Results')).toBeInTheDocument()
    expect(screen.getByText('Call Model')).toBeInTheDocument()
    expect(screen.getByText('Network Warning')).toBeInTheDocument()
    expect(screen.getAllByLabelText('步骤状态：成功')).toHaveLength(2)
    expect(screen.getAllByLabelText('步骤状态：失败')).toHaveLength(2)

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    expect(items[0]).toHaveStyle({ gridTemplateColumns: '16px 28px 10px minmax(0, 1fr)' })
    expect(within(items[0]!).getByText('Thinking').parentElement).toHaveStyle({ whiteSpace: 'nowrap' })
    expect(within(items[0]!).queryByText('思考 / 成功')).not.toBeInTheDocument()
  })
})
