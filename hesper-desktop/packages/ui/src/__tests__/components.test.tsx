import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message, RunStep, Session } from '@hesper/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { ConversationView } from '../conversation/ConversationView'
import { FullscreenOutput } from '../conversation/FullscreenOutput'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'

const now = '2026-06-10T03:00:00.000Z'

const baseSession = {
  id: 'session-1',
  title: '测试会话',
  status: 'active',
  outputMode: 'markdown',
  createdAt: now,
  updatedAt: now
} satisfies Session

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

    const titleBar = screen.getByLabelText('窗口标题栏')
    expect(titleBar).toHaveTextContent('构建 hesper MVP')
    expect(titleBar).not.toHaveTextContent(/^hesper$/)
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
    expect(modelSelect.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    expect(modelSelect.parentElement).toHaveStyle({ minWidth: '0' })
    expect(sendButton.parentElement).toHaveStyle({ gap: '4px' })
    expect(sendButton.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()

    await user.click(modelSelect)
    expect(screen.getByRole('listbox', { name: '选择模型选项' })).toHaveStyle({ display: 'grid' })

    await user.type(textarea, 'hello')
    expect(sendButton).toBeEnabled()
  })

  it('shows model choices as connection groups and expands models on hover', async () => {
    const user = userEvent.setup()
    const onModelChange = vi.fn()

    render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="deepseek-chat"
        outputMode="markdown"
        modelOptions={['mock/hesper-fast', 'deepseek-chat', 'gpt-4o']}
        modelOptionGroups={[
          { id: 'mock', label: 'Mock', options: [{ value: 'mock/hesper-fast', label: 'Mock/mock/hesper-fast' }] },
          { id: 'deepseek', label: 'DeepSeek', options: [{ value: 'deepseek-chat', label: 'DeepSeek/deepseek-chat' }] },
          { id: 'openai', label: 'OpenAI', options: [{ value: 'gpt-4o', label: 'OpenAI/gpt-4o' }] }
        ]}
        onModelChange={onModelChange}
        onSend={() => undefined}
      />
    )

    const modelSelect = screen.getByRole('button', { name: '选择模型' })
    expect(modelSelect).toHaveTextContent('DeepSeek/deepseek-chat')

    await user.click(modelSelect)
    expect(screen.getByRole('listbox', { name: '选择模型选项' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '连接 DeepSeek' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'DeepSeek/deepseek-chat' })).not.toBeInTheDocument()

    await user.hover(screen.getByRole('button', { name: '连接 OpenAI' }))
    const openAiSubmenu = await screen.findByLabelText('OpenAI 模型')
    expect(openAiSubmenu).toHaveStyle({
      position: 'absolute',
      right: 'calc(100% + 6px)',
      top: '0px'
    })
    const openAiModel = await screen.findByRole('option', { name: 'OpenAI/gpt-4o' })
    expect(openAiSubmenu).toContainElement(openAiModel)
    await user.click(openAiModel)

    expect(onModelChange).toHaveBeenCalledWith('gpt-4o')
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

  it('renders markdown output as formatted elements instead of raw text', () => {
    render(
      <OutputBlock
        content={'## Summary\n\nThis is **important** and `inline code`.\n\n- first item\n- second item\n\n| Name | Status |\n| --- | --- |\n| Alpha | **Ready** |\n| Beta | `Blocked` |\n\n[Docs](https://example.com/docs)'}
        contentType="markdown"
      />
    )

    expect(screen.getByRole('heading', { level: 2, name: 'Summary' })).toBeInTheDocument()
    expect(screen.getByText('important')).toHaveStyle({ fontWeight: '700' })
    expect(screen.getByText('inline code').tagName).toBe('CODE')
    const list = screen.getByRole('list')
    expect(list).toBeInTheDocument()
    expect(within(list).getByText('first item')).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Alpha' })).toBeInTheDocument()
    expect(within(screen.getByRole('cell', { name: 'Ready' })).getByText('Ready')).toHaveStyle({ fontWeight: '700' })
    expect(within(screen.getByRole('cell', { name: 'Blocked' })).getByText('Blocked').tagName).toBe('CODE')
    expect(screen.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://example.com/docs')
    expect(screen.queryByText('## Summary')).not.toBeInTheDocument()
    expect(screen.queryByText('| Name | Status |')).not.toBeInTheDocument()
  })

  it('auto-expands running steps and collapses them when final output appears', () => {
    const userMessage = {
      id: 'message-user',
      sessionId: 'session-1',
      role: 'user',
      content: '请读取 README',
      contentType: 'markdown',
      runId: 'run-1',
      createdAt: now
    } satisfies Message
    const runningSteps = [
      { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'succeeded', title: '思考过程', summary: '先确认目标', createdAt: now },
      { id: 'step-tool', runId: 'run-1', type: 'tool_call', status: 'running', title: '调用 read_file', summary: '读取 README 了解项目结构', createdAt: '2026-06-10T03:00:01.000Z' }
    ] satisfies RunStep[]

    const renderConversation = (messages: Message[]) => (
      <ConversationView
        session={baseSession}
        messages={messages}
        steps={[]}
        stepsByRun={{ 'run-1': runningSteps }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const { rerender } = render(renderConversation([userMessage]))

    const toggle = screen.getByRole('button', { name: /调用 read_file/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)

    rerender(renderConversation([
      userMessage,
      {
        id: 'message-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: '最终输出',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: '2026-06-10T03:00:02.000Z'
      } satisfies Message
    ]))

    expect(screen.getByRole('button', { name: /调用 read_file/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText('最终输出')).toBeInTheDocument()
  })

  it('routes wheel scrolling to output blocks unless Ctrl is held', () => {
    const messages = [
      {
        id: 'message-user',
        sessionId: 'session-1',
        role: 'user',
        content: '生成长输出',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: now
      },
      {
        id: 'message-assistant',
        sessionId: 'session-1',
        role: 'assistant',
        content: Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行`).join('\n\n'),
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: '2026-06-10T03:00:01.000Z'
      }
    ] satisfies Message[]

    render(
      <ConversationView
        session={baseSession}
        messages={messages}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const conversationScroller = screen.getByLabelText('消息列表')
    const outputScroller = screen.getByLabelText('输出内容滚动区')
    expect(outputScroller).toHaveStyle({ maxHeight: '340px', boxSizing: 'border-box' })

    fireEvent.wheel(outputScroller, { deltaY: 48 })
    expect(outputScroller.scrollTop).toBe(48)
    expect(conversationScroller.scrollTop).toBe(0)

    fireEvent.wheel(outputScroller, { deltaY: 32, ctrlKey: true })
    expect(outputScroller.scrollTop).toBe(48)
    expect(conversationScroller.scrollTop).toBe(32)

    fireEvent.wheel(conversationScroller, { deltaY: 20 })
    expect(conversationScroller.scrollTop).toBe(52)

    const ctrlWheelOnConversationChrome = new WheelEvent('wheel', { deltaY: 80, ctrlKey: true, bubbles: true, cancelable: true })
    screen.getByRole('heading', { name: '测试会话' }).dispatchEvent(ctrlWheelOnConversationChrome)
    expect(ctrlWheelOnConversationChrome.defaultPrevented).toBe(true)
    expect(conversationScroller.scrollTop).toBe(132)
  })

  it('opens fullscreen output when ctrl-left-clicking inside an output block', () => {
    render(<OutputBlock content="final answer" contentType="markdown" />)

    const outputScroller = screen.getByLabelText('输出内容滚动区')
    fireEvent.click(outputScroller, { button: 0, ctrlKey: true })

    const dialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    expect(dialog).toBeInTheDocument()
    expect(within(dialog).getByText('final answer')).toBeInTheDocument()
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

  it('prevents fullscreen output scrolling from leaking to the conversation underneath', async () => {
    const user = userEvent.setup()
    render(
      <ConversationView
        session={baseSession}
        messages={[
          {
            id: 'message-user',
            sessionId: 'session-1',
            role: 'user',
            content: '生成长输出',
            contentType: 'markdown',
            runId: 'run-1',
            createdAt: now
          },
          {
            id: 'message-assistant',
            sessionId: 'session-1',
            role: 'assistant',
            content: Array.from({ length: 40 }, (_, index) => `第 ${index + 1} 行`).join('\n\n'),
            contentType: 'markdown',
            runId: 'run-1',
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const conversationScroller = screen.getByLabelText('消息列表')
    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))

    const dialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    expect(dialog).toHaveStyle({ position: 'fixed', top: '36px', right: '0px', bottom: '0px', left: '0px', padding: '0px' })

    const fullscreenScroller = screen.getByLabelText('最大化输出滚动区')
    fireEvent.wheel(fullscreenScroller, { deltaY: 72 })
    expect(fullscreenScroller.scrollTop).toBe(72)
    expect(conversationScroller.scrollTop).toBe(0)

    const ctrlWheel = new WheelEvent('wheel', { deltaY: 28, ctrlKey: true, bubbles: true, cancelable: true })
    fullscreenScroller.dispatchEvent(ctrlWheel)
    expect(ctrlWheel.defaultPrevented).toBe(true)
    expect(fullscreenScroller.scrollTop).toBe(100)
    expect(conversationScroller.scrollTop).toBe(0)
  })

  it('renders fullscreen output below the titlebar with centered content and themed icon controls', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onClose = vi.fn()

    render(<FullscreenOutput open content="copy me" contentType="markdown" onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    expect(dialog).toHaveStyle({ position: 'fixed', top: '36px', right: '0px', bottom: '0px', left: '0px', display: 'grid' })
    expect(dialog).toHaveStyle({ placeItems: 'stretch center' })
    expect(dialog).toHaveStyle({ background: 'rgba(9, 12, 20, 0.42)', backdropFilter: 'blur(18px) saturate(140%)' })
    const contentShell = screen.getByLabelText('最大化输出内容')
    expect(contentShell).toHaveStyle({ width: '100%', maxWidth: '1120px' })
    expect(contentShell).toHaveStyle({ margin: '0 auto' })

    const copyButton = screen.getByRole('button', { name: '复制输出内容' })
    const closeButton = screen.getByRole('button', { name: '关闭全屏输出' })
    expect(copyButton.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    expect(closeButton.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument()
    expect(copyButton).not.toHaveTextContent('复制内容')
    expect(closeButton).not.toHaveTextContent('关闭')

    await user.click(copyButton)
    expect(writeText).toHaveBeenCalledWith('copy me')
    await user.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders run steps without latest-step label or header status dot', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        steps={[
          { id: 'step-1', runId: 'run-1', type: 'thought', status: 'succeeded', title: 'Mock thinking', summary: 'Generated deterministic mock response', createdAt: now },
          { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Search Files', summary: 'Searching repo', createdAt: '2026-06-10T03:00:01.000Z' },
          { id: 'step-3', runId: 'run-1', type: 'warning', status: 'failed', title: 'Network Warning', createdAt: '2026-06-10T03:00:02.000Z' }
        ]}
      />
    )

    const stepsRegion = screen.getByLabelText('步骤流')
    expect(stepsRegion).toHaveStyle({ borderStyle: 'none', background: 'transparent' })

    const toggle = screen.getByRole('button', { name: /Network Warning/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('3')
    expect(toggle).toHaveTextContent('Network Warning')
    expect(toggle).not.toHaveTextContent('最新步骤')
    expect(within(toggle).queryByLabelText(/步骤状态/)).not.toBeInTheDocument()
    expect(toggle).toHaveStyle({ gridTemplateColumns: '16px 28px minmax(0, 1fr)' })
    expect(screen.queryByText('Generated deterministic mock response')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Generated deterministic mock response')).toBeInTheDocument()
    expect(screen.queryByText('Mock thinking')).not.toBeInTheDocument()
    expect(screen.getByText('Searching repo')).toBeInTheDocument()
    expect(screen.getAllByText('Network Warning')).toHaveLength(2)
    expect(screen.getByLabelText('步骤状态：成功')).toBeInTheDocument()
    expect(screen.getByLabelText('步骤状态：运行中')).toBeInTheDocument()
    expect(screen.getByLabelText('步骤状态：失败')).toBeInTheDocument()

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    expect(items[0]).toHaveStyle({ gridTemplateColumns: '16px 28px minmax(0, 1fr)' })
    expect(within(items[0]!).getByText('Generated deterministic mock response')).toHaveStyle({ whiteSpace: 'nowrap' })
    expect(within(items[0]!).queryByText('思考 / 成功')).not.toBeInTheDocument()
  })

  it('renders step title with muted summary and detail segments', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        steps={[
          {
            id: 'step-tool',
            runId: 'run-1',
            type: 'tool_call',
            status: 'running',
            title: '工具：web_fetch-url',
            summary: '搜索 Hesper 是什么',
            detail: '{"url":"https://example.com"}',
            createdAt: now
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: /工具：web_fetch-url/ }))

    const item = screen.getByRole('listitem')
    expect(within(item).getByText('工具：web_fetch-url')).toBeInTheDocument()
    expect(within(item).getByText('搜索 Hesper 是什么')).toHaveStyle({ color: '#969db8' })
    expect(within(item).getByText('{"url":"https://example.com"}')).toHaveStyle({ color: '#969db8' })
  })
})
