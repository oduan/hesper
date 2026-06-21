import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentRun, LocalFilePreview, Message, RunStep, Session, WorkerAgentInvocation } from '@hesper/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { Composer } from '../conversation/Composer'
import { ConversationView } from '../conversation/ConversationView'
import { FullscreenOutput } from '../conversation/FullscreenOutput'
import { MarkdownOutput } from '../conversation/MarkdownOutput'
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

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })
  return { promise, resolve, reject }
}

function renderConversationWithAssistant(content: string, loadLocalFilePreview?: (path: string) => Promise<LocalFilePreview>) {
  return render(
    <ConversationView
      session={baseSession}
      messages={[
        {
          id: 'message-assistant-local-preview',
          sessionId: 'session-1',
          role: 'assistant',
          content,
          contentType: 'markdown',
          createdAt: now
        }
      ]}
      steps={[]}
      streamingText=""
      modelId="mock/hesper-fast"
      onSend={() => undefined}
      {...(loadLocalFilePreview ? { loadLocalFilePreview } : {})}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
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
    expect(screen.getByLabelText('主工作区')).toHaveStyle({ gridTemplateColumns: '204px 427px minmax(0, 1fr)' })
    const sessionRow = screen.getByRole('button', { name: '视频脚本生成' })
    expect(sessionRow).toHaveStyle({ alignItems: 'center' })
    expect(sessionRow).toHaveTextContent('视频脚本生成')
    expect(sessionRow).not.toHaveTextContent('gpt-4o')
    expect(sessionRow).not.toHaveTextContent('C:/workspace')
    expect(screen.getByLabelText('窗口标题栏')).toHaveClass('titlebar-drag')

    fireEvent.contextMenu(sessionRow)
    expect(sessionRow).not.toHaveClass('is-selected')
    const menu = screen.getByRole('menu', { name: '会话操作' })
    expect(menu).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)', borderRadius: '12px', padding: '4px 0' })
    expect(menu.querySelector('style')).toHaveTextContent('.hesper-session-menu-item:hover::after')
    expect(menu.querySelector('style')).not.toHaveTextContent('keyframes')
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

    const windowControlButtons = ['最小化窗口', '最大化窗口', '关闭窗口'].map((label) => screen.getByRole('button', { name: label }))
    const windowControlIcons = windowControlButtons.map((button) => button.querySelector('svg[aria-hidden="true"]'))
    expect(windowControlIcons).toHaveLength(3)
    for (const icon of windowControlIcons) {
      expect(icon).toHaveAttribute('width', '14')
      expect(icon).toHaveAttribute('height', '14')
    }
    expect(windowControlButtons.map((button) => button.style.color)).toEqual([
      'var(--hesper-color-text-muted, #737aa2)',
      'var(--hesper-color-text-muted, #737aa2)',
      'var(--hesper-color-text-muted, #737aa2)'
    ])
    expect(windowControlButtons[2]).not.toHaveStyle({ color: '#f3f4f6' })

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

  it('renders builtin tools with global enable switches in the entity list', async () => {
    const user = userEvent.setup()
    const onSelectTool = vi.fn()
    const onToggleToolEnabled = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="tools"
        title="工具"
        tools={[
          {
            id: 'filesystem.read-file',
            name: 'Read File',
            description: 'Read a text file from the selected workspace.',
            category: 'filesystem',
            inputSchema: { type: 'object', required: ['path'], properties: { path: { type: 'string' } } },
            enabled: true
          },
          {
            id: 'filesystem.write-file',
            name: 'Write File',
            description: 'Write a text file in the selected workspace.',
            category: 'filesystem',
            inputSchema: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string' } } },
            enabled: false
          }
        ]}
        activeToolId="filesystem.read-file"
        onSelectTool={onSelectTool}
        onToggleToolEnabled={onToggleToolEnabled}
      />
    )

    expect(screen.getByRole('button', { name: '工具' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('工具列表')).toHaveClass('hesper-theme-scrollbar')
    expect(screen.getByText('Read File').closest('[role="button"]')).toHaveClass('is-active')
    expect(screen.getByText('Read a text file from the selected workspace.')).toBeInTheDocument()

    const readSwitch = screen.getByRole('switch', { name: 'Read File 全局开关' })
    const readTrack = readSwitch.querySelector('[data-tool-toggle-track="true"]') as HTMLElement
    const readKnob = readSwitch.querySelector('[data-tool-toggle-knob="true"]') as HTMLElement
    expect(readSwitch).toHaveAttribute('aria-checked', 'true')
    expect(readTrack).toHaveStyle({ background: 'var(--hesper-color-tool-toggle, #7aa2f7)' })
    expect(readKnob).toHaveStyle({ transform: 'translateX(22px)' })

    const writeRow = screen.getByText('Write File').closest('[role="button"]') as HTMLElement
    const writeSwitch = screen.getByRole('switch', { name: 'Write File 全局开关' })
    const writeTrack = writeSwitch.querySelector('[data-tool-toggle-track="true"]') as HTMLElement
    const writeKnob = writeSwitch.querySelector('[data-tool-toggle-knob="true"]') as HTMLElement
    expect(writeSwitch).toHaveAttribute('aria-checked', 'false')
    expect(writeTrack).toHaveStyle({ background: 'var(--hesper-color-surface-muted, #24283b)' })
    expect(writeKnob).toHaveStyle({ transform: 'translateX(0)' })
    expect(writeKnob).toHaveStyle({ background: 'var(--hesper-color-text-muted, #737aa2)' })

    await user.click(writeRow)
    expect(onSelectTool).toHaveBeenCalledWith('filesystem.write-file')

    await user.click(writeSwitch)
    expect(onToggleToolEnabled).toHaveBeenCalledWith('filesystem.write-file', true)
    expect(onSelectTool).toHaveBeenCalledTimes(1)
  })

  it('renders role list rows without a create role action', async () => {
    const user = userEvent.setup()
    const onSelectRole = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={[
          { id: 'role-ops', name: '运维助手', description: '执行命令' },
          { id: 'role-search', name: '搜索专家', description: '搜索资料' }
        ]}
        activeRoleId="role-ops"
        onSelectRole={onSelectRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    expect(screen.getByRole('button', { name: /运维助手/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('执行命令')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '新建角色' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /搜索专家/ }))
    expect(onSelectRole).toHaveBeenCalledWith('role-search')
  })

  it('renders fallback description for roles without description', async () => {
    const user = userEvent.setup()
    const onSelectRole = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={[{ id: 'role-fallback', name: '整理助手' }]}
        activeRoleId="role-fallback"
        onSelectRole={onSelectRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    expect(screen.getByText('暂无简介')).toBeInTheDocument()
    const fallbackRoleRow = screen.getByRole('button', { name: '整理助手 暂无简介' })
    expect(fallbackRoleRow).toHaveAttribute('aria-current', 'page')

    await user.click(fallbackRoleRow)
    expect(onSelectRole).toHaveBeenCalledWith('role-fallback')
  })

  it('supports shift range selection for roles and keeps the last clicked role active', async () => {
    const user = userEvent.setup()
    const onSelectRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' },
      { id: 'role-3', name: '角色三', description: '第三位' },
      { id: 'role-4', name: '角色四', description: '第四位' }
    ]

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onSelectRole={onSelectRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const firstRow = screen.getByRole('button', { name: /角色一/ })
    const secondRow = screen.getByRole('button', { name: /角色二/ })
    const thirdRow = screen.getByRole('button', { name: /角色三/ })
    const fourthRow = screen.getByRole('button', { name: /角色四/ })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })

    expect(onSelectRole).toHaveBeenLastCalledWith('role-3')
    for (const row of [firstRow, secondRow, thirdRow]) {
      expect(row).toHaveClass('is-selected')
      expect(row).toHaveAttribute('aria-selected', 'true')
    }
    expect(fourthRow).not.toHaveClass('is-selected')
    expect(fourthRow).not.toHaveAttribute('aria-selected', 'true')
  })

  it('deletes the selected role range from the role context menu', async () => {
    const user = userEvent.setup()
    const onDeleteRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' },
      { id: 'role-3', name: '角色三', description: '第三位' },
      { id: 'role-4', name: '角色四', description: '第四位' }
    ]

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onDeleteRole={onDeleteRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const firstRow = screen.getByRole('button', { name: /角色一/ })
    const secondRow = screen.getByRole('button', { name: /角色二/ })
    const thirdRow = screen.getByRole('button', { name: /角色三/ })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)

    const menu = screen.getByRole('menu', { name: '角色操作' })
    await user.click(within(menu).getByRole('menuitem', { name: '删除' }))

    expect(onDeleteRole).toHaveBeenCalledWith('role-2', ['role-1', 'role-2', 'role-3'])
  })

  it('context-selects an unselected role before deleting only that role', async () => {
    const user = userEvent.setup()
    const onDeleteRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' },
      { id: 'role-3', name: '角色三', description: '第三位' }
    ]

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onDeleteRole={onDeleteRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const firstRow = screen.getByRole('button', { name: /角色一/ })
    const secondRow = screen.getByRole('button', { name: /角色二/ })
    const thirdRow = screen.getByRole('button', { name: /角色三/ })

    await user.click(firstRow)
    fireEvent.click(secondRow, { shiftKey: true })
    fireEvent.contextMenu(thirdRow)

    expect(firstRow).not.toHaveClass('is-selected')
    expect(secondRow).not.toHaveClass('is-selected')
    expect(thirdRow).toHaveClass('is-selected')
    expect(thirdRow).toHaveAttribute('aria-selected', 'true')

    await user.click(within(screen.getByRole('menu', { name: '角色操作' })).getByRole('menuitem', { name: '删除' }))

    expect(onDeleteRole).toHaveBeenCalledWith('role-3', ['role-3'])
  })

  it('opens the role context menu from the keyboard and focuses delete', async () => {
    const user = userEvent.setup()
    const onDeleteRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' }
    ]

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onDeleteRole={onDeleteRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const secondRow = screen.getByRole('button', { name: /角色二/ })
    secondRow.focus()
    fireEvent.keyDown(secondRow, { key: 'F10', shiftKey: true })

    const menu = await screen.findByRole('menu', { name: '角色操作' })
    const deleteItem = within(menu).getByRole('menuitem', { name: '删除' })
    await waitFor(() => expect(deleteItem).toHaveFocus())

    await user.keyboard('{Enter}')

    expect(onDeleteRole).toHaveBeenCalledWith('role-2', ['role-2'])
  })

  it('keeps role selection unchanged when role interactions are disabled', async () => {
    const user = userEvent.setup()
    const onSelectRole = vi.fn()
    const onDeleteRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' },
      { id: 'role-3', name: '角色三', description: '第三位' }
    ]

    const { rerender } = render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onSelectRole={onSelectRole}
        onDeleteRole={onDeleteRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const firstRow = screen.getByRole('button', { name: /角色一/ })
    const secondRow = screen.getByRole('button', { name: /角色二/ })
    const thirdRow = screen.getByRole('button', { name: /角色三/ })
    await user.click(firstRow)
    expect(firstRow).toHaveClass('is-selected')

    onSelectRole.mockClear()
    rerender(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        roleSelectionDisabled
        onSelectRole={onSelectRole}
        onDeleteRole={onDeleteRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    await user.click(secondRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    fireEvent.contextMenu(secondRow)

    expect(firstRow).toHaveClass('is-selected')
    expect(secondRow).not.toHaveClass('is-selected')
    expect(thirdRow).not.toHaveClass('is-selected')
    expect(onSelectRole).not.toHaveBeenCalled()
    expect(onDeleteRole).not.toHaveBeenCalled()
    expect(screen.queryByRole('menu', { name: '角色操作' })).not.toBeInTheDocument()
  })

  it('clears role range selection on a normal role click', async () => {
    const user = userEvent.setup()
    const onSelectRole = vi.fn()
    const roles = [
      { id: 'role-1', name: '角色一', description: '第一位' },
      { id: 'role-2', name: '角色二', description: '第二位' },
      { id: 'role-3', name: '角色三', description: '第三位' },
      { id: 'role-4', name: '角色四', description: '第四位' }
    ]

    render(
      <AppShell
        sessions={[]}
        activeSection="roles"
        title="角色"
        roles={roles}
        activeRoleId="role-1"
        onSelectRole={onSelectRole}
      >
        <div>Role detail</div>
      </AppShell>
    )

    const firstRow = screen.getByRole('button', { name: /角色一/ })
    const secondRow = screen.getByRole('button', { name: /角色二/ })
    const thirdRow = screen.getByRole('button', { name: /角色三/ })
    const fourthRow = screen.getByRole('button', { name: /角色四/ })

    await user.click(firstRow)
    fireEvent.click(thirdRow, { shiftKey: true })
    await user.click(fourthRow)

    expect(onSelectRole).toHaveBeenLastCalledWith('role-4')
    expect(firstRow).not.toHaveClass('is-selected')
    expect(secondRow).not.toHaveClass('is-selected')
    expect(thirdRow).not.toHaveClass('is-selected')
    expect(fourthRow).toHaveClass('is-selected')
    expect(fourthRow).toHaveAttribute('aria-selected', 'true')
  })

  it('renders empty role list state', () => {
    render(
      <AppShell sessions={[]} activeSection="roles" title="角色" roles={[]}>
        <div>Role detail</div>
      </AppShell>
    )

    expect(screen.getByText('暂无角色')).toBeInTheDocument()
  })

  it('shows dynamic single-unit relative update times in session rows', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-10T03:00:59.000Z'))

    render(
      <AppShell
        sessions={[
          {
            id: 'session-relative-time',
            title: '带更新时间的会话',
            status: 'active',
            outputMode: 'markdown',
            createdAt: now,
            updatedAt: '2026-06-10T03:00:00.000Z'
          }
        ]}
        activeSection="sessions"
        activeSessionId="session-relative-time"
        title="构建 hesper MVP"
      />
    )

    expect(screen.getByRole('button', { name: '带更新时间的会话' })).toBeInTheDocument()
    expect(screen.getByText('59秒')).toHaveStyle({ color: 'var(--hesper-color-text-muted, #737aa2)', opacity: '0.72' })

    act(() => {
      vi.advanceTimersByTime(15_000)
    })

    expect(screen.queryByText('59秒')).not.toBeInTheDocument()
    expect(screen.getByText('1分钟')).toBeInTheDocument()
  })

  it('shows the same nine-dot running animation before running session titles', () => {
    render(
      <AppShell
        sessions={[
          {
            id: 'session-running',
            title: '正在执行会话',
            status: 'active',
            outputMode: 'markdown',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'session-idle',
            title: '空闲会话',
            status: 'active',
            outputMode: 'markdown',
            createdAt: now,
            updatedAt: now
          }
        ]}
        activeSection="sessions"
        activeSessionId="session-running"
        runningSessionIds={['session-running']}
        title="运行中会话测试"
      />
    )

    const runningRow = screen.getByRole('button', { name: '正在执行会话' })
    const idleRow = screen.getByRole('button', { name: '空闲会话' })
    const runningIcon = runningRow.querySelector('[data-step-status-icon="running-nine-dot-sweep"]')
    expect(runningIcon).toBeInTheDocument()
    expect(runningIcon).toHaveAttribute('aria-hidden', 'true')
    expect(runningIcon).not.toHaveAttribute('aria-label')
    const runningDots = [...runningIcon?.querySelectorAll('[data-step-running-dot]') ?? []]
    expect(runningDots.map((dot) => dot.getAttribute('data-step-running-dot')).join('')).toBe('321478965')
    expect(runningDots[0]).toHaveStyle({ animationDuration: '1260ms', animationDelay: '0ms' })
    expect(runningDots.at(-1)).toHaveStyle({ animationDelay: '720ms' })
    expect(runningIcon?.querySelector('style')).toHaveTextContent('34%')
    expect(idleRow.querySelector('[data-step-status-icon="running-nine-dot-sweep"]')).not.toBeInTheDocument()
  })

  it('shows a new message icon before unread completed session titles', () => {
    render(
      <AppShell
        sessions={[
          {
            id: 'session-unread',
            title: '未查看结果',
            status: 'active',
            outputMode: 'markdown',
            unreadCompletedAt: '2026-06-10T03:02:00.000Z',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'session-running-unread',
            title: '运行优先',
            status: 'active',
            outputMode: 'markdown',
            unreadCompletedAt: '2026-06-10T03:02:00.000Z',
            createdAt: now,
            updatedAt: now
          },
          {
            id: 'session-read',
            title: '已查看结果',
            status: 'active',
            outputMode: 'markdown',
            createdAt: now,
            updatedAt: now
          }
        ]}
        activeSection="sessions"
        activeSessionId="session-read"
        runningSessionIds={['session-running-unread']}
        title="未读结果测试"
      />
    )

    const unreadRow = screen.getByRole('button', { name: '未查看结果' })
    const runningUnreadRow = screen.getByRole('button', { name: '运行优先' })
    const readRow = screen.getByRole('button', { name: '已查看结果' })
    expect(unreadRow.querySelector('[data-session-unread-icon="new-message"]')).toBeInTheDocument()
    expect(unreadRow.querySelector('[data-step-status-icon="running-nine-dot-sweep"]')).not.toBeInTheDocument()
    expect(runningUnreadRow.querySelector('[data-step-status-icon="running-nine-dot-sweep"]')).toBeInTheDocument()
    expect(runningUnreadRow.querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument()
    expect(readRow.querySelector('[data-session-unread-icon="new-message"]')).not.toBeInTheDocument()
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
    const modelListbox = screen.getByRole('listbox', { name: '选择模型选项' })
    expect(modelListbox).toHaveStyle({ display: 'grid' })
    expect(modelListbox.querySelector('style')).toHaveTextContent('.hesper-themed-select-option:hover')
    expect(within(modelListbox).getByRole('option', { name: 'mock/hesper-fast' })).toHaveClass('hesper-themed-select-option')

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
    const groupedListbox = screen.getByRole('listbox', { name: '选择模型选项' })
    expect(groupedListbox).toBeInTheDocument()
    expect(groupedListbox.querySelector('style')).toHaveTextContent('.hesper-themed-select-group-button:hover')
    expect(screen.getByRole('button', { name: '连接 DeepSeek' })).toHaveClass('hesper-themed-select-group-button')
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

  it('renders a stop button instead of send while the session is running', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    const onStop = vi.fn()

    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={onSend} running onStop={onStop} />)

    expect(screen.queryByRole('button', { name: '发送' })).not.toBeInTheDocument()
    const stopButton = screen.getByRole('button', { name: '停止' })
    expect(stopButton).toBeEnabled()

    await user.click(stopButton)

    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('uses controlled draft values when provided', async () => {
    const user = userEvent.setup()
    const onDraftChange = vi.fn()

    const { rerender } = render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" value="first draft" onDraftChange={onDraftChange} onSend={() => undefined} />)
    const textarea = screen.getByPlaceholderText(/输入消息/)
    expect(textarea).toHaveValue('first draft')

    await user.type(textarea, '!')
    expect(onDraftChange).toHaveBeenLastCalledWith('first draft!')

    rerender(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" value="restored draft" onDraftChange={onDraftChange} onSend={() => undefined} />)
    expect(textarea).toHaveValue('restored draft')
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

  it('recognizes workspace markdown links and preserves regular web links', async () => {
    const user = userEvent.setup()
    const onLocalFileClick = vi.fn()

    render(
      <MarkdownOutput
        content="查看 [报告](workspace:docs/report%20final.md) 和 [官网](https://example.com/docs)"
        onLocalFileClick={onLocalFileClick}
      />
    )

    const workspaceLink = screen.getByRole('link', { name: '报告' })
    expect(workspaceLink).toHaveAttribute('href', 'workspace:docs/report%20final.md')
    await user.click(workspaceLink)
    expect(onLocalFileClick).toHaveBeenCalledWith('docs/report final.md')
    expect(onLocalFileClick).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: '官网' })).toHaveAttribute('href', 'https://example.com/docs')
  })

  it('downgrades invalid workspace markdown links to plain labels', async () => {
    const user = userEvent.setup()
    const onLocalFileClick = vi.fn()

    render(
      <MarkdownOutput
        content="非法 [绝对路径](workspace:/tmp/file.md)、[上级目录](workspace:docs/../secret.md)、[NUL](workspace:bad%00file.txt)、[空](workspace:)"
        onLocalFileClick={onLocalFileClick}
      />
    )

    expect(screen.queryByRole('link', { name: '绝对路径' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '上级目录' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'NUL' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '空' })).not.toBeInTheDocument()
    expect(screen.queryByText(/\[空]\(workspace:\)/)).not.toBeInTheDocument()
    await user.click(screen.getByText('绝对路径'))
    await user.click(screen.getByText('上级目录'))
    await user.click(screen.getByText('NUL'))
    await user.click(screen.getByText('空'))
    expect(onLocalFileClick).not.toHaveBeenCalled()
  })

  it.each([
    [
      'markdown',
      {
        path: 'docs/readme.md',
        name: 'readme.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        bytes: 18,
        content: '# 预览标题\n\n正文'
      } satisfies LocalFilePreview
    ],
    [
      'json',
      {
        path: 'data/sample.json',
        name: 'sample.json',
        kind: 'json',
        mimeType: 'application/json',
        bytes: 16,
        content: '{\n  "ok": true\n}'
      } satisfies LocalFilePreview
    ],
    [
      'image',
      {
        path: 'assets/pixel.png',
        name: 'pixel.png',
        kind: 'image',
        mimeType: 'image/png',
        bytes: 68,
        dataUrl: 'data:image/png;base64,iVBORw0KGgo='
      } satisfies LocalFilePreview
    ]
  ])('opens the local file preview dialog and renders %s previews from assistant markdown', async (_kind, preview) => {
    const user = userEvent.setup()
    const deferred = createDeferred<LocalFilePreview>()
    const loadLocalFilePreview = vi.fn(() => deferred.promise)
    renderConversationWithAssistant(`[打开文件](workspace:${preview.path})`, loadLocalFilePreview)

    await user.click(screen.getByRole('link', { name: '打开文件' }))

    expect(loadLocalFilePreview).toHaveBeenCalledWith(preview.path)
    const dialog = screen.getByRole('dialog', { name: '本地文件全屏预览' })
    expect(dialog).toHaveTextContent(preview.path)
    expect(dialog).toHaveTextContent('加载中')

    deferred.resolve(preview)

    if (preview.kind === 'markdown') {
      expect(await screen.findByRole('heading', { name: '预览标题' })).toBeInTheDocument()
    } else if (preview.kind === 'json') {
      expect(await screen.findByText(/"ok": true/)).toBeInTheDocument()
    } else {
      const image = await screen.findByRole('img', { name: 'pixel.png' })
      expect(image).toHaveAttribute('src', preview.dataUrl)
    }
  })

  it('sandboxes pdf local file preview iframes', async () => {
    const user = userEvent.setup()
    const loadLocalFilePreview = vi.fn(async (): Promise<LocalFilePreview> => ({
      path: 'docs/preview.pdf',
      name: 'preview.pdf',
      kind: 'pdf',
      mimeType: 'application/pdf',
      bytes: 128,
      dataUrl: 'data:application/pdf;base64,JVBERi0xLjQ='
    }))
    renderConversationWithAssistant('[打开 PDF](workspace:docs/preview.pdf)', loadLocalFilePreview)

    await user.click(screen.getByRole('link', { name: '打开 PDF' }))

    const pdfFrame = await screen.findByTitle('preview.pdf')
    expect(pdfFrame).toHaveAttribute('sandbox', '')
    expect(pdfFrame).toHaveAttribute('src', 'data:application/pdf;base64,JVBERi0xLjQ=')
  })

  it.each(['resolve', 'reject'] as const)('ignores late local preview %s after conversation unmount', async (settleMode) => {
    const user = userEvent.setup()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const deferred = createDeferred<LocalFilePreview>()
    const loadLocalFilePreview = vi.fn(() => deferred.promise)
    const { unmount } = renderConversationWithAssistant('[卸载文件](workspace:docs/unmount.md)', loadLocalFilePreview)

    await user.click(screen.getByRole('link', { name: '卸载文件' }))
    expect(screen.getByRole('dialog', { name: '本地文件全屏预览' })).toHaveTextContent('加载中')

    unmount()
    if (settleMode === 'reject') {
      deferred.promise.catch(() => undefined)
    }

    await act(async () => {
      if (settleMode === 'resolve') {
        deferred.resolve({
          path: 'docs/unmount.md',
          name: 'unmount.md',
          kind: 'markdown',
          mimeType: 'text/markdown',
          bytes: 12,
          content: '# 已卸载'
        })
      } else {
        deferred.reject(new Error('late failure'))
      }
      await Promise.resolve()
    })

    expect(consoleError).not.toHaveBeenCalled()
  })

  it('shows a Chinese error when the local file preview loader rejects', async () => {
    const user = userEvent.setup()
    const loadLocalFilePreview = vi.fn(async () => {
      throw new Error('磁盘不可读')
    })
    renderConversationWithAssistant('[打开失败文件](workspace:docs/broken.md)', loadLocalFilePreview)

    await user.click(screen.getByRole('link', { name: '打开失败文件' }))

    expect(await screen.findByText(/加载本地文件预览失败/)).toBeInTheDocument()
    expect(screen.getByText(/磁盘不可读/)).toBeInTheDocument()
  })

  it('closes the local file preview dialog with Escape', async () => {
    const user = userEvent.setup()
    const loadLocalFilePreview = vi.fn(async (): Promise<LocalFilePreview> => ({
      path: 'docs/esc.md',
      name: 'esc.md',
      kind: 'markdown',
      mimeType: 'text/markdown',
      bytes: 12,
      content: '# 可关闭'
    }))
    renderConversationWithAssistant('[打开可关闭文件](workspace:docs/esc.md)', loadLocalFilePreview)

    await user.click(screen.getByRole('link', { name: '打开可关闭文件' }))
    expect(await screen.findByRole('heading', { name: '可关闭' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '本地文件全屏预览' })).not.toBeInTheDocument())
  })

  it('routes workspace links inside fullscreen markdown output through the same local preview loader', async () => {
    const user = userEvent.setup()
    const loadLocalFilePreview = vi.fn(async (): Promise<LocalFilePreview> => ({
      path: 'docs/from-fullscreen.md',
      name: 'from-fullscreen.md',
      kind: 'markdown',
      mimeType: 'text/markdown',
      bytes: 21,
      content: '# 来自全屏输出'
    }))
    renderConversationWithAssistant('[全屏附件](workspace:docs/from-fullscreen.md)', loadLocalFilePreview)

    await user.click(screen.getByRole('button', { name: '全屏查看输出' }))
    const fullscreenDialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    await user.click(within(fullscreenDialog).getByRole('link', { name: '全屏附件' }))

    expect(loadLocalFilePreview).toHaveBeenCalledWith('docs/from-fullscreen.md')
    expect(await screen.findByRole('dialog', { name: '本地文件全屏预览' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '来自全屏输出' })).toBeInTheDocument()
  })

  it('closes only the top local preview when opened from tool output details', async () => {
    const user = userEvent.setup()
    const loadLocalFilePreview = vi.fn(async (): Promise<LocalFilePreview> => ({
      path: 'docs/tool-attachment.md',
      name: 'tool-attachment.md',
      kind: 'markdown',
      mimeType: 'text/markdown',
      bytes: 18,
      content: '# 工具附件'
    }))
    render(
      <ConversationView
        session={baseSession}
        messages={[]}
        steps={[
          {
            id: 'step-tool-preview-escape',
            runId: 'run-tool-preview-escape',
            type: 'tool_call',
            status: 'succeeded',
            title: 'Read File',
            detail: JSON.stringify({
              kind: 'tool_call',
              input: { path: 'docs/tool-attachment.md' },
              output: '[打开工具附件](workspace:docs/tool-attachment.md)'
            }),
            createdAt: now
          }
        ]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
        loadLocalFilePreview={loadLocalFilePreview}
      />
    )

    await user.click(screen.getByRole('button', { name: '查看步骤详情：Read File' }))
    const stepDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    await user.click(within(stepDialog).getByRole('link', { name: '打开工具附件' }))

    expect(loadLocalFilePreview).toHaveBeenCalledWith('docs/tool-attachment.md')
    expect(await screen.findByRole('dialog', { name: '本地文件全屏预览' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: '工具附件' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '本地文件全屏预览' })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: '步骤全屏查看' })).toBeInTheDocument()
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

  it('does not collapse live elapsed time to zero before durable run success arrives', () => {
    vi.useFakeTimers({ now: new Date('2026-06-10T03:00:05.000Z') })
    const messages = [
      {
        id: 'message-user-live-timer',
        sessionId: 'session-1',
        role: 'user',
        content: '测试计时器',
        contentType: 'markdown',
        runId: 'run-live-timer',
        createdAt: now
      },
      {
        id: 'message-assistant-live-timer',
        sessionId: 'session-1',
        role: 'assistant',
        content: '最终输出',
        contentType: 'markdown',
        runId: 'run-live-timer',
        createdAt: now
      }
    ] satisfies Message[]
    const steps = [
      { id: 'step-live-timer-tool', runId: 'run-live-timer', type: 'tool_call', status: 'succeeded', title: '调用工具', summary: '读取上下文', createdAt: now }
    ] satisfies RunStep[]
    const runningRun = {
      id: 'run-live-timer',
      sessionId: 'session-1',
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 2,
      startedAt: now
    } satisfies AgentRun

    const { rerender } = render(
      <ConversationView
        session={baseSession}
        messages={messages}
        steps={[]}
        stepsByRun={{ 'run-live-timer': steps }}
        runsById={{ 'run-live-timer': runningRun }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    expect(screen.getByLabelText('步骤流')).toHaveTextContent('5秒')
    expect(screen.getByLabelText('步骤流')).not.toHaveTextContent('0秒')

    rerender(
      <ConversationView
        session={baseSession}
        messages={messages}
        steps={[]}
        stepsByRun={{ 'run-live-timer': steps }}
        runsById={{ 'run-live-timer': { ...runningRun, status: 'succeeded', endedAt: '2026-06-10T03:00:07.000Z' } }}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    expect(screen.getByLabelText('步骤流')).toHaveTextContent('7秒')
  })

  it('routes wheel scrolling to output blocks and uses Ctrl wheel to jump between user inputs', () => {
    const messages = [
      {
        id: 'message-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: '第一条用户输入',
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: now
      },
      {
        id: 'message-assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: Array.from({ length: 30 }, (_, index) => `第 ${index + 1} 行`).join('\n\n'),
        contentType: 'markdown',
        runId: 'run-1',
        createdAt: '2026-06-10T03:00:01.000Z'
      },
      {
        id: 'message-user-2',
        sessionId: 'session-1',
        role: 'user',
        content: '第二条用户输入',
        contentType: 'markdown',
        runId: 'run-2',
        createdAt: '2026-06-10T03:01:00.000Z'
      },
      {
        id: 'message-assistant-2',
        sessionId: 'session-1',
        role: 'assistant',
        content: '第二条输出',
        contentType: 'markdown',
        runId: 'run-2',
        createdAt: '2026-06-10T03:01:01.000Z'
      },
      {
        id: 'message-user-3',
        sessionId: 'session-1',
        role: 'user',
        content: '第三条用户输入',
        contentType: 'markdown',
        runId: 'run-3',
        createdAt: '2026-06-10T03:02:00.000Z'
      },
      {
        id: 'message-assistant-3',
        sessionId: 'session-1',
        role: 'assistant',
        content: '第三条输出',
        contentType: 'markdown',
        runId: 'run-3',
        createdAt: '2026-06-10T03:02:01.000Z'
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

    const conversationScroller = screen.getByLabelText('消息列表') as HTMLElement
    const outputScroller = screen.getAllByLabelText('输出内容滚动区')[0] as HTMLElement
    expect(outputScroller).toHaveStyle({ maxHeight: '570px', boxSizing: 'border-box', overscrollBehavior: 'contain' })

    const userAnchors = [...conversationScroller.querySelectorAll<HTMLElement>('[data-hesper-user-message-anchor="true"]')]
    expect(userAnchors).toHaveLength(3)
    for (const [index, anchor] of userAnchors.entries()) {
      Object.defineProperty(anchor, 'offsetTop', { configurable: true, value: [0, 420, 860][index] })
    }

    const regularWheel = new WheelEvent('wheel', { deltaY: 48, bubbles: true, cancelable: true })
    outputScroller.dispatchEvent(regularWheel)
    expect(regularWheel.defaultPrevented).toBe(false)
    expect(conversationScroller.scrollTop).toBe(0)

    outputScroller.scrollTop = 48
    fireEvent.wheel(outputScroller, { deltaY: 32, ctrlKey: true })
    expect(outputScroller.scrollTop).toBe(48)
    expect(conversationScroller.scrollTop).toBe(420)

    fireEvent.wheel(conversationScroller, { deltaY: 20 })
    expect(conversationScroller.scrollTop).toBe(440)

    conversationScroller.scrollTop = 860
    const ctrlWheelOnConversationChrome = new WheelEvent('wheel', { deltaY: -80, ctrlKey: true, bubbles: true, cancelable: true })
    screen.getByRole('heading', { name: '测试会话' }).dispatchEvent(ctrlWheelOnConversationChrome)
    expect(ctrlWheelOnConversationChrome.defaultPrevented).toBe(true)
    expect(conversationScroller.scrollTop).toBe(420)
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
    expect(previewFrame.closest('.hesper-output-block')).toHaveStyle({ height: '450px', maxHeight: '570px' })
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

  it('uses tool icons for successful tool-call steps while preserving failure fallback', () => {
    render(
      <RunSteps
        autoExpanded
        steps={[
          {
            id: 'step-tool-success',
            runId: 'run-icons',
            type: 'tool_call',
            status: 'succeeded',
            title: '调用 Read File',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', toolIcon: '📖', input: { path: 'README.md' }, output: 'ok' }),
            createdAt: now
          },
          {
            id: 'step-tool-failed',
            runId: 'run-icons',
            type: 'tool_call',
            status: 'failed',
            title: '调用 Read File',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', toolIcon: '📖', input: { path: 'README.md' }, output: 'boom', isError: true }),
            createdAt: '2026-06-10T03:00:01.000Z'
          },
          {
            id: 'step-tool-no-icon',
            runId: 'run-icons',
            type: 'tool_call',
            status: 'succeeded',
            title: '调用 Unknown',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'unknown.tool', input: {}, output: 'ok' }),
            createdAt: '2026-06-10T03:00:02.000Z'
          }
        ]}
      />
    )

    const statusIcons = screen.getAllByLabelText('步骤状态：成功')
    expect(statusIcons[0]).toHaveAttribute('data-step-status-icon', 'tool-success-icon')
    expect(statusIcons[0]).toHaveTextContent('📖')
    expect(statusIcons[1]).toHaveAttribute('data-step-status-icon', 'success-check')
    expect(screen.getByLabelText('步骤状态：失败')).toHaveAttribute('data-step-status-icon', 'failed-cross')
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

  it('renders structured tool call rows as action then purpose without inline resource', () => {
    render(
      <RunSteps
        autoExpanded
        steps={[
          {
            id: 'step-tool-display',
            runId: 'run-1',
            type: 'tool_call',
            status: 'running',
            title: 'filesystem_read-file',
            detail: JSON.stringify({
              kind: 'tool_call',
              displayName: '读取文件',
              resource: 'README.md',
              input: { path: 'README.md', purpose: '读取 README 了解项目结构' }
            }),
            createdAt: now
          }
        ]}
      />
    )

    const item = screen.getByRole('listitem')
    expect(item).toHaveTextContent('读取文件')
    expect(item).toHaveTextContent('读取 README 了解项目结构')
    expect(item).not.toHaveTextContent('README.md')
    expect(item).not.toHaveTextContent('filesystem_read-file')
    expect(item.querySelector('[data-hesper-tool-resource="true"]')).not.toBeInTheDocument()
    expect(within(item).getByText('读取 README 了解项目结构')).toHaveStyle({ color: 'var(--hesper-color-text-muted, #737aa2)' })
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
    expect(item).not.toHaveTextContent('https://example.com')
    expect(item.querySelector('[data-hesper-tool-resource="true"]')).not.toBeInTheDocument()
    await user.click(within(item).getByRole('button', { name: /查看步骤详情/ }))

    const dialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    const inputBlock = within(dialog).getByLabelText('Input')
    const outputBlock = within(dialog).getByLabelText('Output')
    expect(inputBlock.parentElement).toHaveStyle({ gridTemplateColumns: 'minmax(0, 1fr)' })
    expect(inputBlock).toHaveTextContent('"url": "https://example.com"')
    expect(inputBlock).toHaveTextContent('"purpose": "搜索 Hesper 是什么"')
    expect(outputBlock).toHaveTextContent('"content": "fetched html"')
    expect(outputBlock).toHaveTextContent('"status": 200')
  })

  it('opens Worker Agent execution details for worker tool steps and renders worker history', async () => {
    const user = userEvent.setup()
    const workerInvocation = {
      id: 'worker-invocation-1',
      parentRunId: 'run-parent',
      parentStepId: 'step-worker',
      childRunId: 'run-child',
      task: 'Review the diff and explain the risk.',
      contextSummary: 'Inspect README before summarising the worker result.',
      expectedOutput: 'A concise risk summary with action items.',
      roleId: 'worker-reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      status: 'running',
      createdAt: now
    } satisfies WorkerAgentInvocation
    const childRun = {
      id: 'run-child',
      sessionId: 'session-1',
      parentRunId: 'run-parent',
      workerAgentInvocationId: 'worker-invocation-1',
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 2,
      startedAt: now
    }
    const childStep = {
      id: 'step-child-tool',
      runId: 'run-child',
      type: 'tool_call',
      status: 'succeeded',
      title: 'Read File',
      summary: 'Inspect README',
      detail: JSON.stringify({ kind: 'tool_call', toolId: 'filesystem.read-file', toolIcon: '📖', input: { path: 'README.md' }, output: 'ok' }),
      createdAt: '2026-06-10T03:00:01.000Z'
    }
    const childMessage = {
      id: 'message-child-final',
      sessionId: 'session-1',
      role: 'assistant',
      content: 'final worker answer',
      contentType: 'markdown',
      runId: 'run-child',
      createdAt: '2026-06-10T03:00:03.000Z'
    }

    render(
      <RunSteps
        steps={[
          {
            id: 'step-worker',
            runId: 'run-parent',
            type: 'tool_call',
            status: 'running',
            title: 'Spawn Worker Agent',
            summary: 'Spawn worker to review the diff',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'agent.spawn-worker-agent', input: { task: workerInvocation.task }, output: 'accepted' }),
            createdAt: now
          }
        ]}
        workerAgentView={{
          invocationsByParentStepId: { 'step-worker': workerInvocation },
          runsById: { 'run-child': childRun },
          stepsByRun: { 'run-child': [childStep] },
          messagesByRun: { 'run-child': [childMessage] },
          streamingByRun: { 'run-child': 'streaming child output' }
        } as any}
      />
    )

    await user.click(screen.getByRole('button', { expanded: false }))
    const item = screen.getByRole('listitem')
    await user.click(within(item).getByRole('button', { name: /查看步骤详情/ }))

    const dialog = screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })
    expect(within(dialog).getByText('Review the diff and explain the risk.')).toBeInTheDocument()
    expect(within(dialog).getByText('Inspect README before summarising the worker result.')).toBeInTheDocument()
    expect(within(dialog).getByText('A concise risk summary with action items.')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: '查看步骤详情：Read File' })).toHaveTextContent('Inspect README')
    expect(within(dialog).getByText('worker-reviewer')).toBeInTheDocument()
    expect(within(dialog).getByText('filesystem.read-file')).toBeInTheDocument()
    expect(within(dialog).getByText('git.status')).toBeInTheDocument()
    expect(within(dialog).getByText('streaming child output')).toBeInTheDocument()
    expect(within(dialog).getByText('final worker answer')).toBeInTheDocument()
    expect(within(dialog).queryByText('Input')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: '查看步骤详情：Read File' }))
    const innerDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    fireEvent.keyDown(innerDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: '步骤全屏查看' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })).toBeInTheDocument()

    const outerDialog = screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })
    fireEvent.keyDown(outerDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: 'Worker Agent 执行详情' })).not.toBeInTheDocument()
  })
})
