import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Message, RunStep, Session } from '@hesper/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { ConversationView } from '../conversation/ConversationView'
import { FullscreenOutput } from '../conversation/FullscreenOutput'
import { MessageBubble } from '../conversation/MessageBubble'
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
  vi.useRealTimers()
})

describe('ui components', () => {
  it('renders high-density desktop shell rails and panes', async () => {
    const user = userEvent.setup()
    const onCreateSession = vi.fn()
    const onSelectSection = vi.fn()
    const onWindowMinimize = vi.fn()
    const onWindowToggleMaximize = vi.fn()
    const onWindowClose = vi.fn()
    const onRenameSession = vi.fn()

    render(
      <AppShell
        sessions={[
          {
            id: 'session-list-1',
            title: '视频脚本生成',
            status: 'active',
            workspacePath: 'C:/workspace',
            defaultModelId: 'gpt-4o',
            outputMode: 'markdown',
            createdAt: now,
            updatedAt: now
          }
        ]}
        activeSection="sessions"
        activeSessionId="session-list-1"
        title="构建 hesper MVP"
        onCreateSession={onCreateSession}
        onSelectSection={onSelectSection}
        onRenameSession={onRenameSession}
        onWindowMinimize={onWindowMinimize}
        onWindowToggleMaximize={onWindowToggleMaximize}
        onWindowClose={onWindowClose}
      />
    )

    const titleBar = screen.getByLabelText('窗口标题栏')
    expect(titleBar).toHaveTextContent('Hesper')
    expect(titleBar).toHaveTextContent('构建 hesper MVP')
    expect(screen.getByLabelText('功能栏')).not.toHaveTextContent('hesper')
    expect(screen.getByText('所有会话')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '所有会话' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('功能栏')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('实体列表')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('会话列表')).toHaveClass('hesper-theme-scrollbar')
    expect(screen.getByLabelText('主工作区')).toHaveStyle({ gridTemplateColumns: '204px 320px minmax(0, 1fr)' })
    const sessionRow = screen.getByRole('button', { name: '视频脚本生成' })
    expect(sessionRow).toHaveStyle({ alignItems: 'center' })
    expect(sessionRow).toHaveTextContent('视频脚本生成')
    expect(sessionRow).not.toHaveTextContent('gpt-4o')
    expect(sessionRow).not.toHaveTextContent('C:/workspace')
    expect(screen.getByLabelText('窗口标题栏')).toHaveClass('titlebar-drag')

    fireEvent.contextMenu(sessionRow)
    const menu = screen.getByRole('menu', { name: '会话操作' })
    expect(menu).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)', borderRadius: '12px', padding: '4px 0' })
    expect(menu.querySelector('style')).toHaveTextContent('hesper-session-menu-ripple')
    expect(menu.querySelector('style')).toHaveTextContent('.hesper-session-menu-item:hover::before')
    for (const label of ['重命名', '重新生成标题', '删除']) {
      const item = within(menu).getByRole('menuitem', { name: label })
      expect(item).toHaveClass('hesper-session-menu-item')
      expect(item).toHaveStyle({ width: '100%', borderRadius: '0px', justifyContent: 'flex-start', overflow: 'hidden' })
    }

    await user.click(within(menu).getByRole('menuitem', { name: '重命名' }))
    const renameInput = await screen.findByLabelText('重命名会话标题')
    expect(renameInput).toHaveValue('视频脚本生成')
    await user.clear(renameInput)
    await user.type(renameInput, '短标题{Enter}')
    expect(onRenameSession).toHaveBeenCalledWith('session-list-1', '短标题')

    const windowControlIcons = ['最小化窗口', '最大化窗口', '关闭窗口'].map((label) => screen.getByRole('button', { name: label }).querySelector('svg[aria-hidden="true"]'))
    expect(windowControlIcons).toHaveLength(3)
    for (const icon of windowControlIcons) {
      expect(icon).toHaveAttribute('width', '14')
      expect(icon).toHaveAttribute('height', '14')
    }

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

  it('supports shift range selection for session context bulk actions while rename stays target-only', async () => {
    const user = userEvent.setup()
    const onSelectSession = vi.fn()
    const onRegenerateSessionTitle = vi.fn()
    const onDeleteSession = vi.fn()
    const onRenameSession = vi.fn()
    const sessions = ['会话一', '会话二', '会话三', '会话四'].map((title, index) => ({
      id: `session-${index + 1}`,
      title,
      status: 'active' as const,
      outputMode: 'markdown' as const,
      createdAt: now,
      updatedAt: now
    }))

    render(
      <AppShell
        sessions={sessions}
        activeSection="sessions"
        activeSessionId="session-1"
        title="多选测试"
        onSelectSession={onSelectSession}
        onRegenerateSessionTitle={onRegenerateSessionTitle}
        onDeleteSession={onDeleteSession}
        onRenameSession={onRenameSession}
      />
    )

    const firstRow = screen.getByRole('button', { name: '会话一' })
    const secondRow = screen.getByRole('button', { name: '会话二' })
    const thirdRow = screen.getByRole('button', { name: '会话三' })
    const fourthRow = screen.getByRole('button', { name: '会话四' })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })

    expect(onSelectSession).toHaveBeenLastCalledWith('session-3')
    expect(firstRow).toHaveClass('is-selected')
    expect(secondRow).toHaveClass('is-selected')
    expect(thirdRow).toHaveClass('is-selected')
    expect(fourthRow).not.toHaveClass('is-selected')

    fireEvent.contextMenu(thirdRow)
    await user.click(within(screen.getByRole('menu', { name: '会话操作' })).getByRole('menuitem', { name: '重新生成标题' }))
    expect(onRegenerateSessionTitle).toHaveBeenCalledWith('session-3', ['session-1', 'session-2', 'session-3'])

    fireEvent.contextMenu(secondRow)
    await user.click(within(screen.getByRole('menu', { name: '会话操作' })).getByRole('menuitem', { name: '删除' }))
    expect(onDeleteSession).toHaveBeenCalledWith('session-2', ['session-1', 'session-2', 'session-3'])

    fireEvent.contextMenu(secondRow)
    await user.click(within(screen.getByRole('menu', { name: '会话操作' })).getByRole('menuitem', { name: '重命名' }))
    const renameInput = await screen.findByLabelText('重命名会话标题')
    expect(renameInput).toHaveValue('会话二')
    await user.clear(renameInput)
    await user.type(renameInput, '只改第二个{Enter}')
    expect(onRenameSession).toHaveBeenCalledWith('session-2', '只改第二个')
  })

  it('disables send button when composer is empty and keeps controls visually aligned', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={() => undefined} />)
    const textarea = screen.getByPlaceholderText(/输入消息/)
    const modelSelect = screen.getByRole('button', { name: '选择模型' })
    const sendButton = screen.getByRole('button', { name: '发送' })

    expect(sendButton).toBeDisabled()
    expect(screen.getByLabelText('消息输入区')).toHaveStyle({ borderRadius: '20px' })
    expect(textarea).toHaveStyle({ borderRadius: '0' })
    expect(textarea).toHaveStyle({ boxSizing: 'border-box', fontSize: 'var(--hesper-font-size, 14px)', lineHeight: '1.5', padding: '0px 1px' })
    expect(textarea).not.toHaveStyle({ font: 'inherit' })
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
      <Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={onSend} sendSignal={sendSignal} />
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

  it('renders a tiny local date-time stamp outside the user message background', () => {
    render(
      <MessageBubble
        message={{
          id: 'message-user-time',
          sessionId: 'session-1',
          role: 'user',
          content: '这是一条用户输入',
          contentType: 'plain',
          createdAt: now
        }}
      />
    )

    const bubble = screen.getByLabelText('用户消息')
    expect(bubble).toHaveStyle({ fontSize: 'var(--hesper-font-size, 14px)' })
    const timestamp = screen.getByLabelText(/^发送时间：/)
    expect(bubble).not.toContainElement(timestamp)
    expect(timestamp.parentElement).toContainElement(bubble)
    expect(timestamp.tagName).toBe('TIME')
    expect(timestamp).toHaveAttribute('dateTime', now)
    expect(timestamp).toHaveTextContent(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/)
    expect(timestamp).toHaveStyle({ justifySelf: 'end', fontSize: '9px', lineHeight: '1' })
  })

  it('does not render a date-time stamp inside assistant message bubbles', () => {
    render(
      <MessageBubble
        message={{
          id: 'message-assistant-time',
          sessionId: 'session-1',
          role: 'assistant',
          content: '助手输出',
          contentType: 'plain',
          createdAt: now
        }}
      />
    )

    expect(screen.getByLabelText('助手消息')).toHaveStyle({ fontSize: 'var(--hesper-font-size, 14px)' })
    expect(screen.queryByLabelText(/^发送时间：/)).not.toBeInTheDocument()
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

  it('auto-expands running steps, shows elapsed time before the first tool intent, and stops when final output appears', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T03:00:05.000Z') })
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

    const stepsRegion = screen.getByLabelText('步骤流')
    const toggle = within(stepsRegion).getByRole('button', { expanded: true })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveTextContent('2')
    expect(toggle).toHaveTextContent('5秒')
    expect(toggle.textContent).toMatch(/2\s*5秒\s*读取 README 了解项目结构/)
    expect(toggle).toHaveTextContent('读取 README 了解项目结构')
    expect(toggle).not.toHaveTextContent('调用 read_file')
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

    const collapsedToggle = within(stepsRegion).getByRole('button', { expanded: false })
    expect(collapsedToggle).toHaveAttribute('aria-expanded', 'false')
    expect(collapsedToggle).toHaveTextContent('2秒')
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
    expect(outputScroller).toHaveStyle({ maxHeight: '380px', boxSizing: 'border-box', overscrollBehavior: 'contain' })

    const regularWheel = new WheelEvent('wheel', { deltaY: 48, bubbles: true, cancelable: true })
    outputScroller.dispatchEvent(regularWheel)
    expect(regularWheel.defaultPrevented).toBe(false)
    expect(conversationScroller.scrollTop).toBe(0)

    outputScroller.scrollTop = 48
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
    expect(fullscreenScroller).toHaveStyle({ overscrollBehavior: 'contain' })
    const regularWheel = new WheelEvent('wheel', { deltaY: 72, bubbles: true, cancelable: true })
    fullscreenScroller.dispatchEvent(regularWheel)
    expect(regularWheel.defaultPrevented).toBe(false)
    expect(conversationScroller.scrollTop).toBe(0)

    fullscreenScroller.scrollTop = 72
    const ctrlWheel = new WheelEvent('wheel', { deltaY: 28, ctrlKey: true, bubbles: true, cancelable: true })
    fullscreenScroller.dispatchEvent(ctrlWheel)
    expect(ctrlWheel.defaultPrevented).toBe(true)
    expect(fullscreenScroller.scrollTop).toBe(100)
    expect(conversationScroller.scrollTop).toBe(0)
  })

  it('renders fullscreen output below the titlebar with unified background, centered content, and top-right controls', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    const onClose = vi.fn()

    render(<FullscreenOutput open content="copy me" contentType="markdown" onClose={onClose} />)

    const dialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    expect(dialog).toHaveStyle({ position: 'fixed', top: '36px', right: '0px', bottom: '0px', left: '0px', display: 'block' })
    expect(dialog).toHaveStyle({ background: 'var(--hesper-color-surface, #16161e)' })
    expect(dialog).not.toHaveStyle({ backdropFilter: 'blur(18px) saturate(140%)' })

    const contentShell = screen.getByLabelText('最大化输出内容')
    expect(contentShell).toHaveStyle({ width: '100%', height: '100%', background: 'transparent', borderStyle: 'none' })
    expect(contentShell).not.toHaveStyle({ maxWidth: '1120px' })
    expect(contentShell).not.toHaveStyle({ boxShadow: '0 24px 80px rgba(0, 0, 0, 0.38)' })

    const contentBody = screen.getByLabelText('最大化输出正文')
    expect(contentBody).toHaveStyle({ maxWidth: '1120px', margin: '0 auto' })
    expect(contentBody).toHaveStyle({ background: 'transparent', borderStyle: 'none' })

    const actions = screen.getByLabelText('最大化输出操作')
    expect(actions).toHaveStyle({ position: 'absolute', top: '16px', right: '16px' })
    expect(within(dialog).queryByText('输出')).not.toBeInTheDocument()

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
          { id: 'step-2', runId: 'run-1', type: 'tool_call', status: 'running', title: 'Search Files', summary: 'Searching repo', detail: '## 工具结果\n\n- 第一项', createdAt: '2026-06-10T03:00:01.000Z' },
          { id: 'step-3', runId: 'run-1', type: 'warning', status: 'failed', title: 'Network Warning', createdAt: '2026-06-10T03:00:02.000Z' }
        ]}
      />
    )

    const stepsRegion = screen.getByLabelText('步骤流')
    expect(stepsRegion).toHaveStyle({ borderStyle: 'none', background: 'transparent' })

    const toggle = screen.getByRole('button', { name: /Searching repo/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveTextContent('3')
    expect(toggle).toHaveTextContent('Searching repo')
    expect(toggle).not.toHaveTextContent('Network Warning')
    expect(toggle).not.toHaveTextContent('最新步骤')
    expect(within(toggle).queryByLabelText(/步骤状态/)).not.toBeInTheDocument()
    expect(toggle).toHaveStyle({ gridTemplateColumns: '18px 28px minmax(0, 1fr)', columnGap: '5px' })
    expect(within(toggle).getByText('▸')).toHaveStyle({ fontSize: '16px' })
    expect(within(toggle).getByText('3')).toHaveStyle({ borderRadius: '8px' })
    expect(within(toggle).getByText('Searching repo')).not.toHaveAttribute('title')
    expect(screen.queryByText('Generated deterministic mock response')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Generated deterministic mock response')).toBeInTheDocument()
    expect(screen.queryByText('Mock thinking')).not.toBeInTheDocument()
    expect(screen.getAllByText('Network Warning')).toHaveLength(1)
    const successStatus = screen.getByLabelText('步骤状态：成功')
    const runningStatus = screen.getByLabelText('步骤状态：运行中')
    const failedStatus = screen.getByLabelText('步骤状态：失败')
    expect(successStatus).not.toHaveAttribute('title')
    expect(runningStatus).not.toHaveAttribute('title')
    expect(failedStatus).not.toHaveAttribute('title')
    expect(successStatus).toHaveAttribute('data-step-status-icon', 'success-check')
    expect(successStatus.querySelector('svg[aria-hidden="true"] circle')).toBeInTheDocument()
    expect(successStatus.querySelector('svg[aria-hidden="true"] path')).toHaveAttribute('d', 'M5.2 8.1 7.1 10 10.9 5.8')
    expect(runningStatus).toHaveAttribute('data-step-status-icon', 'running-nine-dot-sweep')
    const runningDots = [...runningStatus.querySelectorAll('[data-step-running-dot]')]
    expect(runningDots.map((dot) => dot.getAttribute('data-step-running-dot')).join('')).toBe('321478965')
    expect(runningDots[0]).toHaveStyle({ animationDuration: '1260ms', animationDelay: '0ms' })
    expect(runningDots.at(-1)).toHaveStyle({ animationDelay: '720ms' })
    expect(runningStatus.querySelector('style')).toHaveTextContent('34%')
    expect(failedStatus).toHaveAttribute('data-step-status-icon', 'failed-cross')
    expect(failedStatus.querySelector('svg[aria-hidden="true"] circle')).toBeInTheDocument()
    expect(failedStatus.querySelector('svg[aria-hidden="true"] path')).toHaveAttribute('d', 'M5.5 5.5 10.5 10.5M10.5 5.5 5.5 10.5')

    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(3)
    const stepButtons = items.map((item) => within(item).getByRole('button', { name: /查看步骤详情/ }))
    expect(stepButtons[1]).toHaveTextContent('Searching repo')
    expect(stepButtons[0]).toHaveStyle({ gridTemplateColumns: '16px 28px minmax(0, 1fr)' })
    expect(stepsRegion.querySelector('style')).toHaveTextContent('[data-hesper-step-row-button]:hover [data-hesper-step-row-text]')
    for (const item of items) {
      expect(item.querySelector('[title]')).not.toBeInTheDocument()
    }
    expect(within(items[0]!).getByText('Generated deterministic mock response')).toHaveStyle({ whiteSpace: 'nowrap' })
    expect(within(items[0]!).queryByText('思考 / 成功')).not.toBeInTheDocument()

    await user.click(stepButtons[1]!)
    const stepDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    expect(stepDialog).toHaveStyle({ position: 'fixed', top: '36px', right: '0px', bottom: '0px', left: '0px' })
    expect(within(stepDialog).queryByRole('heading', { name: 'Search Files' })).not.toBeInTheDocument()
    expect(within(stepDialog).queryByText('Searching repo')).not.toBeInTheDocument()
    expect(within(stepDialog).getByRole('heading', { name: '工具结果' })).toBeInTheDocument()
    expect(within(stepDialog).getByText('第一项').closest('li')).toBeInTheDocument()
    expect(within(stepDialog).queryByRole('button', { name: '复制输出内容' })).not.toBeInTheDocument()
    fireEvent.keyDown(stepDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: '步骤全屏查看' })).not.toBeInTheDocument()
  })

  it('renders the run steps block before the first tool call with a continuously updating elapsed timer', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T03:00:10.000Z') })
    const { rerender } = render(
      <RunSteps
        autoExpanded
        runStartedAt={now}
        steps={[
          { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'running', title: '思考过程', summary: '正在判断下一步', createdAt: now }
        ]}
      />
    )

    const stepsRegion = screen.getByLabelText('步骤流')
    const toggle = within(stepsRegion).getByRole('button', { expanded: true })
    expect(toggle).toHaveTextContent('1')
    expect(toggle).toHaveTextContent('10秒')
    expect(toggle).not.toHaveTextContent('正在判断下一步')
    expect(screen.getByRole('listitem')).toHaveTextContent('正在判断下一步')

    act(() => {
      vi.advanceTimersByTime(1000)
    })

    expect(toggle).toHaveTextContent('11秒')

    rerender(
      <RunSteps
        autoExpanded
        runStartedAt={now}
        runEndedAt="2026-06-10T03:00:02.000Z"
        steps={[
          { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'succeeded', title: '思考过程', summary: '正在判断下一步', createdAt: now }
        ]}
      />
    )

    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('2秒')

    rerender(
      <RunSteps
        autoExpanded
        runStartedAt="2026-06-10T02:59:06.000Z"
        steps={[
          { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'running', title: '思考过程', summary: '正在判断下一步', createdAt: now }
        ]}
      />
    )

    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('1分05秒')

    rerender(
      <RunSteps
        autoExpanded
        runStartedAt="2026-06-10T01:59:10.000Z"
        steps={[
          { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'running', title: '思考过程', summary: '正在判断下一步', createdAt: now }
        ]}
      />
    )

    expect(screen.getByRole('button', { expanded: true })).toHaveTextContent('1小时01分01秒')
  })

  it('shows conversation run steps immediately after user input and adds the first tool intent only after a tool call exists', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T03:00:07.000Z') })
    const userMessage = {
      id: 'message-user',
      sessionId: 'session-1',
      role: 'user',
      content: '请读取 README',
      contentType: 'markdown',
      createdAt: now
    } satisfies Message
    const linkedUserMessage = { ...userMessage, runId: 'run-1' } satisfies Message

    const renderConversation = (message: Message, runSteps: RunStep[]) => (
      <ConversationView
        session={baseSession}
        messages={[message]}
        steps={[]}
        stepsByRun={{ 'run-1': runSteps }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const { rerender } = render(renderConversation(userMessage, []))

    const initialStepsRegion = screen.getByLabelText('步骤流')
    const initialToggle = within(initialStepsRegion).getByRole('button', { expanded: true })
    expect(initialToggle).toHaveTextContent('0')
    expect(initialToggle).toHaveTextContent('7秒')
    expect(initialToggle).not.toHaveTextContent('读取 README 了解项目结构')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)

    rerender(renderConversation(linkedUserMessage, [
      { id: 'step-thought', runId: 'run-1', type: 'thought', status: 'succeeded', title: '思考过程', summary: '正在判断下一步', createdAt: now },
      { id: 'step-tool', runId: 'run-1', type: 'tool_call', status: 'running', title: '调用 read_file', summary: '读取 README 了解项目结构', createdAt: '2026-06-10T03:00:01.000Z' }
    ]))

    const toolToggle = screen.getByRole('button', { expanded: true })
    expect(toolToggle).toHaveTextContent('2')
    expect(toolToggle).toHaveTextContent('7秒')
    expect(toolToggle.textContent).toMatch(/2\s*7秒\s*读取 README 了解项目结构/)
    expect(toolToggle).toHaveTextContent('读取 README 了解项目结构')
  })

  it('renders tool call title with muted summary and detail segments', async () => {
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

    const toggle = screen.getByRole('button', { expanded: false })
    expect(toggle).toHaveTextContent('搜索 Hesper 是什么')
    expect(toggle).not.toHaveTextContent('工具：web_fetch-url')

    await user.click(toggle)

    const item = screen.getByRole('listitem')
    expect(within(item).getByText('工具：web_fetch-url')).toBeInTheDocument()
    expect(within(item).getByText('搜索 Hesper 是什么')).toHaveStyle({ color: 'var(--hesper-color-text-muted, #737aa2)' })
    expect(within(item).getByText('{"url":"https://example.com"}')).toHaveStyle({ color: 'var(--hesper-color-text-muted, #737aa2)' })
  })

  it('shows tool call fullscreen details as separate input and output blocks', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        steps={[
          {
            id: 'step-tool-structured',
            runId: 'run-1',
            type: 'tool_call',
            status: 'succeeded',
            title: '工具：web_fetch-url',
            summary: '搜索 Hesper 是什么',
            detail: JSON.stringify({
              kind: 'tool_call',
              input: { url: 'https://example.com', purpose: '搜索 Hesper 是什么' },
              output: { content: 'fetched html', details: { status: 200 } },
              isError: false
            }),
            createdAt: now
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { expanded: false }))
    const item = screen.getByRole('listitem')
    expect(item).not.toHaveTextContent('"kind"')
    await user.click(within(item).getByRole('button', { name: /查看步骤详情/ }))

    const dialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    const inputBlock = within(dialog).getByLabelText('Input')
    const outputBlock = within(dialog).getByLabelText('Output')
    expect(inputBlock).toHaveTextContent('"url": "https://example.com"')
    expect(inputBlock).toHaveTextContent('"purpose": "搜索 Hesper 是什么"')
    expect(outputBlock).toHaveTextContent('"content": "fetched html"')
    expect(outputBlock).toHaveTextContent('"status": 200')
  })
})
