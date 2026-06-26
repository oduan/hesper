import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AgentRun, LocalFilePreview, Message, RunStep, Session, WorkerAgentInvocation } from '@hesper/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '../layout/AppShell'
import { ActivityRail } from '../layout/ActivityRail'
import { Composer, type ComposerSkillMention } from '../conversation/Composer'
import { ConversationView } from '../conversation/ConversationView'
import { FullscreenOutput } from '../conversation/FullscreenOutput'
import { MarkdownOutput } from '../conversation/MarkdownOutput'
import { MessageBubble } from '../conversation/MessageBubble'
import { OutputBlock } from '../conversation/OutputBlock'
import { RunSteps } from '../conversation/RunSteps'
import { themeTokens } from '../theme'

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
  window.localStorage.clear()
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
    expect(screen.getByRole('heading', { name: '所有会话' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '所有会话' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('功能栏')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('实体列表')).toHaveStyle({ boxSizing: 'border-box' })
    expect(screen.getByLabelText('会话列表')).toHaveClass('hesper-theme-scrollbar')
    expect(screen.getByLabelText('主工作区')).toHaveStyle({ gridTemplateColumns: '204px 427px minmax(0, 1fr)' })
    expect(screen.getByLabelText('详情区域').firstElementChild).toHaveStyle({ padding: '0px' })
    const sessionRow = screen.getByRole('button', { name: '视频脚本生成' })
    expect(sessionRow).toHaveStyle({ alignItems: 'center' })
    expect(sessionRow).toHaveTextContent('视频脚本生成')
    expect(sessionRow).not.toHaveTextContent('gpt-4o')
    expect(sessionRow).not.toHaveTextContent('C:/workspace')
    expect(screen.getByLabelText('窗口标题栏')).toHaveClass('titlebar-drag')

    fireEvent.contextMenu(sessionRow)
    expect(sessionRow).not.toHaveClass('is-selected')
    const menu = screen.getByRole('menu', { name: '会话操作' })
    expect(menu).toHaveStyle({ background: themeTokens.color.surfaceMuted, borderRadius: '12px', padding: '4px 0' })
    expect(menu).toHaveStyle({ boxShadow: `0 18px 50px ${themeTokens.color.shadow}` })
    expect(menu.querySelector('style')).toHaveTextContent('.hesper-session-menu-item:hover::after')
    expect(menu.querySelector('style')).toHaveTextContent(`background: ${themeTokens.color.hover};`)
    expect(menu.querySelector('style')).not.toHaveTextContent('background: var(--hesper-color-hover);')
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
      themeTokens.color.textMuted,
      themeTokens.color.textMuted,
      themeTokens.color.textMuted
    ])

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

  it('renders session categories under the activity rail and creates a focused new category from all sessions', async () => {
    const user = userEvent.setup()
    const onCreateSessionCategory = vi.fn(async () => ({
      id: 'category-new',
      name: '新分类',
      createdAt: now,
      updatedAt: now
    }))
    const onRenameSessionCategory = vi.fn()
    const onSelectSessionCategory = vi.fn()

    render(
      <AppShell
        sessions={[]}
        sessionCategories={[{ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }]}
        sessionsExpanded
        activeSection="sessions"
        title="所有会话"
        onCreateSessionCategory={onCreateSessionCategory}
        onRenameSessionCategory={onRenameSessionCategory}
        onSelectSessionCategory={onSelectSessionCategory}
      />
    )

    const disclosureButton = screen.getByRole('button', { name: '收起会话分类' })
    const allSessionsButton = screen.getByRole('button', { name: '所有会话' })
    const disclosure = screen.getByTestId('sessions-disclosure-icon')
    expect(disclosureButton).toHaveAttribute('aria-expanded', 'true')
    expect(allSessionsButton).toHaveAttribute('aria-current', 'page')
    expect(disclosure).toHaveAttribute('data-state', 'expanded')
    expect(disclosure.querySelector('svg')).toHaveAttribute('viewBox', '0 0 16 16')
    expect(screen.getByRole('navigation', { name: '会话分类导航' })).toBeInTheDocument()

    fireEvent.contextMenu(allSessionsButton)
    await user.click(within(screen.getByRole('menu', { name: '会话分类操作' })).getByRole('menuitem', { name: '新建分类' }))

    expect(onCreateSessionCategory).toHaveBeenCalledTimes(1)
    const input = (await screen.findByLabelText('重命名分类')) as HTMLInputElement
    expect(input).toHaveValue('新分类')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(3)

    await user.type(input, '头像{Enter}')
    expect(onRenameSessionCategory).toHaveBeenCalledWith('category-new', '头像')
  })

  it('opens category context menu for rename and delete', async () => {
    const user = userEvent.setup()
    const onRenameSessionCategory = vi.fn()
    const onDeleteSessionCategory = vi.fn()

    render(
      <AppShell
        sessions={[]}
        sessionCategories={[{ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }]}
        sessionsExpanded
        activeSection="sessions"
        title="所有会话"
        onRenameSessionCategory={onRenameSessionCategory}
        onDeleteSessionCategory={onDeleteSessionCategory}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '产品图' }))
    const menu = screen.getByRole('menu', { name: '分类操作' })
    await user.click(within(menu).getByRole('menuitem', { name: '重命名' }))

    const input = (await screen.findByLabelText('重命名分类')) as HTMLInputElement
    expect(input).toHaveValue('产品图')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe('产品图'.length)
    await user.clear(input)
    await user.type(input, '商业图{Enter}')
    expect(onRenameSessionCategory).toHaveBeenCalledWith('category-product', '商业图')

    fireEvent.contextMenu(screen.getByRole('button', { name: '产品图' }))
    await user.click(within(screen.getByRole('menu', { name: '分类操作' })).getByRole('menuitem', { name: '删除' }))
    expect(onDeleteSessionCategory).toHaveBeenCalledWith('category-product')
  })

  it('keeps session disclosure icons centered and switches state when collapsed', () => {
    render(
      <AppShell
        sessions={[]}
        sessionCategories={[{ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }]}
        sessionsExpanded={false}
        activeSection="sessions"
        title="所有会话"
      />
    )

    const disclosureButton = screen.getByRole('button', { name: '展开会话分类' })
    const allSessionsButton = screen.getByRole('button', { name: '所有会话' })
    const disclosure = screen.getByTestId('sessions-disclosure-icon')
    const icon = disclosure.querySelector('svg')
    expect(disclosureButton).toHaveAttribute('aria-expanded', 'false')
    expect(allSessionsButton).toHaveAttribute('aria-current', 'page')
    expect(disclosure).toHaveAttribute('data-state', 'collapsed')
    expect(disclosure).toHaveStyle({ width: '16px', height: '16px' })
    expect(icon).toHaveAttribute('viewBox', '0 0 16 16')
    expect(icon).toHaveAttribute('width', '16')
    expect(icon).toHaveAttribute('height', '16')
    expect(screen.queryByRole('navigation', { name: '会话分类导航' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '产品图' })).not.toBeInTheDocument()
  })

  it('toggles sessions internally when expanded prop is provided without a handler', async () => {
    const user = userEvent.setup()

    render(
      <ActivityRail
        activeSection="sessions"
        sessionsExpanded={false}
        sessionCategories={[{ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }]}
      />
    )

    const disclosureButton = screen.getByRole('button', { name: '展开会话分类' })
    expect(disclosureButton).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: '所有会话' })).toBeInTheDocument()
    expect(screen.getByTestId('sessions-disclosure-icon')).toHaveAttribute('data-state', 'collapsed')
    expect(screen.queryByRole('navigation', { name: '会话分类导航' })).not.toBeInTheDocument()

    await user.click(disclosureButton)
    expect(disclosureButton).toHaveAttribute('aria-expanded', 'true')
    expect(disclosureButton).toHaveAttribute('aria-label', '收起会话分类')
    expect(screen.getByTestId('sessions-disclosure-icon')).toHaveAttribute('data-state', 'expanded')
    expect(screen.getByRole('navigation', { name: '会话分类导航' })).toBeInTheDocument()

    await user.click(disclosureButton)
    expect(disclosureButton).toHaveAttribute('aria-expanded', 'false')
    expect(disclosureButton).toHaveAttribute('aria-label', '展开会话分类')
    expect(screen.getByTestId('sessions-disclosure-icon')).toHaveAttribute('data-state', 'collapsed')
    expect(screen.queryByRole('navigation', { name: '会话分类导航' })).not.toBeInTheDocument()
  })

  it('commits category rename on blur and exits editing mode', async () => {
    const user = userEvent.setup()
    const onRenameSessionCategory = vi.fn()

    render(
      <ActivityRail
        activeSection="sessions"
        sessionsExpanded
        sessionCategories={[{ id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }]}
        onRenameSessionCategory={onRenameSessionCategory}
      />
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '产品图' }))
    await user.click(within(screen.getByRole('menu', { name: '分类操作' })).getByRole('menuitem', { name: '重命名' }))

    const input = (await screen.findByLabelText('重命名分类')) as HTMLInputElement
    await user.clear(input)
    await user.type(input, '商业图')
    fireEvent.blur(input)

    await waitFor(() => {
      expect(onRenameSessionCategory).toHaveBeenCalledWith('category-product', '商业图')
    })
    expect(screen.queryByLabelText('重命名分类')).not.toBeInTheDocument()
  })

  it('deletes empty new category on blur and Enter, then exits editing mode', async () => {
    const user = userEvent.setup()
    const onCreateSessionCategory = vi.fn(async () => ({
      id: 'category-new',
      name: '新分类',
      createdAt: now,
      updatedAt: now
    }))
    const onDeleteSessionCategory = vi.fn()

    render(
      <ActivityRail
        activeSection="sessions"
        sessionsExpanded
        sessionCategories={[]}
        onCreateSessionCategory={onCreateSessionCategory}
        onDeleteSessionCategory={onDeleteSessionCategory}
      />
    )

    const createEmptyCategory = async () => {
      fireEvent.contextMenu(screen.getByRole('button', { name: '所有会话' }))
      await user.click(within(screen.getByRole('menu', { name: '会话分类操作' })).getByRole('menuitem', { name: '新建分类' }))
      const input = (await screen.findByLabelText('重命名分类')) as HTMLInputElement
      await user.clear(input)
      return input
    }

    fireEvent.blur(await createEmptyCategory())
    await waitFor(() => {
      expect(onDeleteSessionCategory).toHaveBeenCalledWith('category-new')
    })
    expect(screen.queryByLabelText('重命名分类')).not.toBeInTheDocument()

    await user.type(await createEmptyCategory(), '{Enter}')
    await waitFor(() => {
      expect(onDeleteSessionCategory).toHaveBeenCalledTimes(2)
    })
    expect(onDeleteSessionCategory).toHaveBeenLastCalledWith('category-new')
    expect(screen.queryByLabelText('重命名分类')).not.toBeInTheDocument()
  })

  it('selects all sessions and categories from the activity rail and marks active rows', async () => {
    const user = userEvent.setup()
    const onSelectSection = vi.fn()
    const onSelectSessionCategory = vi.fn()
    const category = { id: 'category-product', name: '产品图', createdAt: now, updatedAt: now }

    const { rerender } = render(
      <ActivityRail
        activeSection="sessions"
        sessionsExpanded
        sessionCategories={[category]}
        onSelectSection={onSelectSection}
        onSelectSessionCategory={onSelectSessionCategory}
      />
    )

    const allSessionsButton = screen.getByRole('button', { name: '所有会话' })
    expect(allSessionsButton).toHaveAttribute('aria-current', 'page')
    expect(allSessionsButton).toHaveClass('is-active')

    const disclosureButton = screen.getByRole('button', { name: '收起会话分类' })
    await user.click(disclosureButton)
    expect(onSelectSection).not.toHaveBeenCalled()
    expect(onSelectSessionCategory).not.toHaveBeenCalled()
    expect(screen.queryByRole('navigation', { name: '会话分类导航' })).not.toBeInTheDocument()

    await user.click(disclosureButton)
    expect(screen.getByRole('navigation', { name: '会话分类导航' })).toBeInTheDocument()

    await user.click(allSessionsButton)
    expect(onSelectSection).toHaveBeenLastCalledWith('sessions')
    expect(onSelectSessionCategory).toHaveBeenLastCalledWith(undefined)

    const categoryButton = screen.getByRole('button', { name: '产品图' })
    expect(categoryButton).not.toHaveAttribute('aria-current')
    await user.click(categoryButton)
    expect(onSelectSection).toHaveBeenLastCalledWith('sessions')
    expect(onSelectSessionCategory).toHaveBeenLastCalledWith('category-product')

    rerender(
      <ActivityRail
        activeSection="sessions"
        activeSessionCategoryId="category-product"
        sessionsExpanded
        sessionCategories={[category]}
        onSelectSection={onSelectSection}
        onSelectSessionCategory={onSelectSessionCategory}
      />
    )

    expect(screen.getByRole('button', { name: '所有会话' })).not.toHaveAttribute('aria-current')
    const activeCategoryButton = screen.getByRole('button', { name: '产品图' })
    expect(activeCategoryButton).toHaveAttribute('aria-current', 'page')
    expect(activeCategoryButton).toHaveClass('is-active')
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
    expect(screen.getByLabelText('详情区域').firstElementChild).toHaveStyle({ padding: '16px' })
    expect(screen.getByLabelText('工具列表')).toHaveClass('hesper-theme-scrollbar')
    expect(screen.getByText('Read File').closest('[role="button"]')).toHaveClass('is-active')
    expect(screen.getByText('Read a text file from the selected workspace.')).toBeInTheDocument()

    const readSwitch = screen.getByRole('switch', { name: 'Read File 全局开关' })
    const readTrack = readSwitch.querySelector('[data-tool-toggle-track="true"]') as HTMLElement
    const readKnob = readSwitch.querySelector('[data-tool-toggle-knob="true"]') as HTMLElement
    expect(readSwitch).toHaveAttribute('aria-checked', 'true')
    expect(readTrack).toHaveStyle({ background: themeTokens.color.toolToggle })
    expect(readTrack).toHaveStyle({ boxShadow: `0 0 0 3px ${themeTokens.color.toolToggleSoft}` })
    expect(readKnob).toHaveStyle({ transform: 'translateX(22px)' })
    expect(readKnob).toHaveStyle({ boxShadow: `0 3px 10px ${themeTokens.color.shadow}` })

    const writeRow = screen.getByText('Write File').closest('[role="button"]') as HTMLElement
    const writeSwitch = screen.getByRole('switch', { name: 'Write File 全局开关' })
    const writeTrack = writeSwitch.querySelector('[data-tool-toggle-track="true"]') as HTMLElement
    const writeKnob = writeSwitch.querySelector('[data-tool-toggle-knob="true"]') as HTMLElement
    expect(writeSwitch).toHaveAttribute('aria-checked', 'false')
    expect(writeTrack).toHaveStyle({ background: themeTokens.color.surfaceMuted })
    expect(writeTrack).toHaveStyle({ boxShadow: `inset 0 0 0 1px ${themeTokens.color.borderSubtle}` })
    expect(writeKnob).toHaveStyle({ transform: 'translateX(0)' })
    expect(writeKnob).toHaveStyle({ background: themeTokens.color.textMuted })
    expect(writeKnob).toHaveStyle({ boxShadow: `0 2px 7px ${themeTokens.color.shadow}` })

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

  it('renders skill list rows with descriptions and selection', async () => {
    const user = userEvent.setup()
    const onSelectSkill = vi.fn()

    render(
      <AppShell
        sessions={[]}
        activeSection="skills"
        title="技能"
        skills={[
          { id: '安装技能', name: '安装技能', description: '安装可复用技能' },
          { id: '写作助手', name: '写作助手' }
        ]}
        activeSkillId="安装技能"
        onSelectSkill={onSelectSkill}
      >
        <div>Skill detail</div>
      </AppShell>
    )

    expect(screen.getByRole('button', { name: '技能' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('技能列表')).toHaveClass('hesper-theme-scrollbar')
    expect(screen.getByRole('button', { name: '安装技能 安装可复用技能' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('安装可复用技能')).toBeInTheDocument()
    expect(screen.getByText('暂无简介')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '写作助手 暂无简介' }))
    expect(onSelectSkill).toHaveBeenCalledWith('写作助手')
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
    expect(screen.getByText('59秒')).toHaveStyle({ color: themeTokens.color.textMuted, opacity: '0.72' })

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

  it('moves selected sessions from the session context category submenu', async () => {
    const user = userEvent.setup()
    const onSetSessionCategory = vi.fn()
    const sessions = ['会话一', '会话二', '会话三'].map((title, index) => ({
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
        sessionCategories={[{ id: 'category-avatar', name: '头像', createdAt: now, updatedAt: now }]}
        activeSection="sessions"
        title="所有会话"
        onSetSessionCategory={onSetSessionCategory}
      />
    )

    await user.click(screen.getByRole('button', { name: '会话一' }))
    await user.keyboard('{Shift>}')
    await user.click(screen.getByRole('button', { name: '会话二' }))
    await user.keyboard('{/Shift}')

    fireEvent.contextMenu(screen.getByRole('button', { name: '会话二' }))
    fireEvent.mouseEnter(within(screen.getByRole('menu', { name: '会话操作' })).getByRole('menuitem', { name: '分类' }))
    await user.click(within(screen.getByRole('menu', { name: '会话分类选项' })).getByRole('menuitem', { name: '头像' }))

    expect(onSetSessionCategory).toHaveBeenCalledWith('session-2', ['session-1', 'session-2'], 'category-avatar')
  })

  it('moves an unselected session to uncategorized from the category submenu', async () => {
    const user = userEvent.setup()
    const onSetSessionCategory = vi.fn()
    const sessions = ['会话一', '会话二', '会话三'].map((title, index) => ({
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
        sessionCategories={[{ id: 'category-avatar', name: '头像', createdAt: now, updatedAt: now }]}
        activeSection="sessions"
        title="所有会话"
        onSetSessionCategory={onSetSessionCategory}
      />
    )

    await user.click(screen.getByRole('button', { name: '会话一' }))

    fireEvent.contextMenu(screen.getByRole('button', { name: '会话三' }))
    fireEvent.mouseEnter(within(screen.getByRole('menu', { name: '会话操作' })).getByRole('menuitem', { name: '分类' }))
    await user.click(within(screen.getByRole('menu', { name: '会话分类选项' })).getByRole('menuitem', { name: '未分类' }))

    expect(onSetSessionCategory).toHaveBeenCalledWith('session-3', ['session-3'], undefined)
  })

  it('disables send button when composer is empty and keeps controls visually aligned', async () => {
    const user = userEvent.setup()
    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={() => undefined} />)
    const textarea = screen.getByPlaceholderText(/输入消息/)
    const workspaceButton = screen.getByRole('button', { name: '选择文件夹：hesper' })
    const modelSelect = screen.getByRole('button', { name: '选择模型' })
    const sendButton = screen.getByRole('button', { name: '发送' })

    expect(workspaceButton).toHaveTextContent('hesper')
    expect(workspaceButton).not.toHaveTextContent('C:/dev/hesper')
    expect(workspaceButton).not.toHaveTextContent('工作目录')
    expect(workspaceButton.querySelector('[data-hesper-workspace-icon="empty-house"]')).toBeInTheDocument()

    expect(sendButton).toBeDisabled()
    expect(screen.getByLabelText('消息输入区')).toHaveStyle({ borderRadius: '20px' })
    expect(textarea).toHaveStyle({ borderRadius: '0' })
    expect(textarea).toHaveStyle({ boxSizing: 'border-box', fontSize: 'var(--hesper-font-size, 14px)', lineHeight: '1.5', padding: '0px 2px' })
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
    expect(modelListbox.querySelector('style')).toHaveTextContent(`background: ${themeTokens.color.hover} !important;`)
    expect(modelListbox.querySelector('style')).toHaveTextContent(`color: ${themeTokens.color.text} !important;`)
    expect(modelListbox.querySelector('style')).not.toHaveTextContent('background: var(--hesper-color-hover) !important;')
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

  it('places thinking intensity below model choices and expands levels on hover', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={onSend} />)

    await user.click(screen.getByRole('button', { name: '选择模型' }))
    const modelListbox = screen.getByRole('listbox', { name: '选择模型选项' })
    const separator = within(modelListbox).getByRole('separator', { name: '模型和思考强度分割线' })
    const thinkingButton = within(modelListbox).getByRole('button', { name: '思考强度：高' })
    expect(separator).toHaveStyle({ marginLeft: '6px', marginRight: '6px' })
    expect(separator.compareDocumentPosition(thinkingButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    await user.hover(thinkingButton)
    const thinkingMenu = await screen.findByLabelText('思考强度选项')
    expect(thinkingMenu).toHaveStyle({
      position: 'absolute',
      right: 'calc(100% + 6px)',
      top: '0px'
    })
    expect(within(thinkingMenu).getAllByRole('option').map((option) => option.textContent)).toEqual(['低', '中', '高', '超高'])

    await user.click(within(thinkingMenu).getByRole('option', { name: '超高' }))
    expect(window.localStorage.getItem('hesper.composer.thinkingLevel')).toBe('xhigh')

    await user.type(screen.getByLabelText('消息输入框'), 'hello')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(onSend).toHaveBeenCalledWith('hello', expect.objectContaining({ thinkingLevel: 'xhigh' }))
  })

  it('restores the previous thinking intensity selection for new composers', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()
    window.localStorage.setItem('hesper.composer.thinkingLevel', 'medium')

    render(<Composer workspacePath="C:/dev/hesper" modelId="mock/hesper-fast" onSend={onSend} />)

    await user.click(screen.getByRole('button', { name: '选择模型' }))
    expect(screen.getByRole('button', { name: '思考强度：中' })).toBeInTheDocument()

    await user.type(screen.getByLabelText('消息输入框'), 'remembered')
    await user.click(screen.getByRole('button', { name: '发送' }))

    expect(onSend).toHaveBeenCalledWith('remembered', expect.objectContaining({ thinkingLevel: 'medium' }))
  })

  it('filters and inserts skill mentions from an independent @ token', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    const { container } = render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[
          { id: 'skill-research', name: 'Research', description: 'Find sources' },
          { id: 'skill-cn', name: '中文写作', description: '中文润色' },
          { id: 'skill-code', name: 'Code Review' }
        ]}
        onSend={onSend}
      />
    )

    const textarea = screen.getByLabelText('消息输入框')
    await user.type(textarea, '请用 @中')

    const listbox = screen.getByRole('listbox', { name: '技能提及建议' })
    expect(listbox).toHaveClass('hesper-skill-mention-menu')
    expect(listbox).toHaveStyle({ width: '20%' })
    const scrollbarStyle = [...container.querySelectorAll('style')].find((style) => style.textContent?.includes('.hesper-skill-mention-menu::-webkit-scrollbar'))
    expect(scrollbarStyle?.textContent).toContain('width: 4px')
    expect(scrollbarStyle?.textContent).toContain('var(--hesper-color-scrollbar-thumb')
    const cnOption = within(listbox).getByRole('option', { name: '选择技能 中文写作：中文润色' })
    expect(cnOption).toHaveTextContent(/^中文写作$/)
    expect(within(listbox).queryByText('中文润色')).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: /Research/ })).not.toBeInTheDocument()

    await user.keyboard('{Enter}')
    expect(textarea).toHaveValue('请用 @中文写作 ')
    const pill = container.querySelector('[data-skill-mention-pill="true"]') as HTMLElement
    expect(pill).toHaveTextContent('@中文写作')
    expect(pill).toHaveStyle({ background: themeTokens.color.softControl, borderRadius: '3px', padding: '0px' })
    expect(pill).toHaveStyle({ boxShadow: `1px 0 0 1px ${themeTokens.color.softControl}`, lineHeight: '1.5' })
    expect(pill.style.fontSize).toBe('')
    expect(pill.style.border).toBe('0px')
    expect(textarea).toHaveClass('hesper-skill-mention-textarea')
    const selectionStyle = [...container.querySelectorAll('style')].find((style) => style.textContent?.includes('.hesper-skill-mention-textarea::selection'))
    expect(selectionStyle?.textContent).toContain('background: #0067d7')
    expect(selectionStyle?.textContent).toContain('color: #ffffff')
    expect(selectionStyle?.textContent).toContain('-webkit-text-fill-color: #ffffff')
    expect(selectionStyle?.textContent).toContain('text-shadow: none')
    expect(textarea).toHaveFocus()

    await user.keyboard('完成{Control>}{Enter}{/Control}')
    expect(onSend).toHaveBeenCalledWith('请用 @中文写作 完成', expect.objectContaining({
      prompt: expect.stringContaining('技能：中文写作'),
      displayPrompt: '请用 @中文写作 完成'
    }))
    const sendOptions = onSend.mock.calls[0]![1]
    expect(sendOptions.prompt).toContain('skills_get')
    expect(sendOptions.prompt).toContain('完整 SKILL.md')
    expect(sendOptions.prompt).not.toContain('call skills.get')
  })

  it('keeps native textarea text visible while skill mention highlighting renders as a background layer', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[{ id: 'skill-superpowers', name: 'using-superpowers' }]}
        onSend={() => undefined}
      />
    )

    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    await user.type(textarea, '@using')
    await user.keyboard('{Enter}')
    await user.type(textarea, '测试一下\n测试一下')

    expect(textarea).toHaveValue('@using-superpowers 测试一下\n测试一下')
    expect(textarea).toHaveClass('hesper-skill-mention-textarea')
    expect(textarea).toHaveStyle({
      color: themeTokens.color.text,
      overflowWrap: 'anywhere',
      whiteSpace: 'pre-wrap'
    })
    expect(textarea.style.color).not.toBe('transparent')

    const pill = container.querySelector('[data-skill-mention-pill="true"]') as HTMLElement
    const mirror = pill.parentElement as HTMLElement
    expect(mirror).toHaveAttribute('aria-hidden', 'true')
    expect(mirror.style.color).toBe('transparent')
    expect(mirror).toHaveStyle({
      overflowWrap: 'anywhere',
      whiteSpace: 'pre-wrap'
    })
    expect(mirror.style.webkitTextFillColor).toBe('transparent')
    expect(pill).toHaveStyle({ background: themeTokens.color.softControl })
  })

  it('keeps selected skill mention metadata when the composer remounts', async () => {
    const user = userEvent.setup()
    const skillOptions = [{ id: 'skill-research', name: 'Research' }]

    function SkillMentionDraftHarness({ visible }: { visible: boolean }) {
      const [draft, setDraft] = useState('')
      const [skillMentions, setSkillMentions] = useState<ComposerSkillMention[]>([])

      return visible ? (
        <Composer
          workspacePath="C:/dev/hesper"
          modelId="mock/hesper-fast"
          skillOptions={skillOptions}
          skillMentions={skillMentions}
          value={draft}
          onDraftChange={setDraft}
          onSkillMentionsChange={setSkillMentions}
          onSend={() => undefined}
        />
      ) : <div>隐藏输入框</div>
    }

    const { container, rerender } = render(<SkillMentionDraftHarness visible />)
    const textarea = screen.getByLabelText('消息输入框')
    await user.type(textarea, '@')
    await user.keyboard('{Enter}')

    expect(textarea).toHaveValue('@Research ')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).toHaveTextContent('@Research')

    rerender(<SkillMentionDraftHarness visible={false} />)
    expect(screen.queryByLabelText('消息输入框')).not.toBeInTheDocument()

    rerender(<SkillMentionDraftHarness visible />)
    expect(screen.getByLabelText('消息输入框')).toHaveValue('@Research ')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).toHaveTextContent('@Research')
  })

  it('deletes a selected skill mention as one pill', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[{ id: 'skill-research', name: 'Research' }]}
        onSend={() => undefined}
      />
    )

    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    await user.type(textarea, '@')
    await user.keyboard('{Enter}')

    expect(textarea).toHaveValue('@Research ')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).toHaveTextContent('@Research')

    textarea.setSelectionRange('@Research '.length, '@Research '.length)
    fireEvent.keyDown(textarea, { key: 'Backspace', code: 'Backspace' })

    expect(textarea).toHaveValue('')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).not.toBeInTheDocument()
  })

  it('deletes a selected skill mention with Delete from the pill start', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[{ id: 'skill-research', name: 'Research' }]}
        onSend={() => undefined}
      />
    )

    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    await user.type(textarea, '@')
    await user.keyboard('{Enter}')

    expect(container.querySelector('[data-skill-mention-pill="true"]')).toHaveTextContent('@Research')

    textarea.setSelectionRange(0, 0)
    fireEvent.keyDown(textarea, { key: 'Delete', code: 'Delete' })

    expect(textarea).toHaveValue('')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).not.toBeInTheDocument()
  })

  it('keeps manually typed skill-looking @ text as ordinary text', async () => {
    const user = userEvent.setup()

    const { container } = render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[{ id: 'skill-research', name: 'Research' }]}
        onSend={() => undefined}
      />
    )

    const textarea = screen.getByLabelText('消息输入框') as HTMLTextAreaElement
    await user.type(textarea, '@Research ')

    expect(textarea).toHaveValue('@Research ')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).not.toBeInTheDocument()

    textarea.setSelectionRange('@Research '.length, '@Research '.length)
    await user.keyboard('{Backspace}')

    expect(textarea).toHaveValue('@Research')
    expect(container.querySelector('[data-skill-mention-pill="true"]')).not.toBeInTheDocument()
  })

  it('moves skill mention selection with arrow keys, scrolls it into view, and closes suggestions with Escape', async () => {
    const user = userEvent.setup()
    const originalScrollIntoView = window.HTMLElement.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scrollIntoView })

    try {
      render(
        <Composer
          workspacePath="C:/dev/hesper"
          modelId="mock/hesper-fast"
          skillOptions={[
            { id: 'skill-research', name: 'Research' },
            { id: 'skill-code', name: 'Code Review' },
            { id: 'skill-docs', name: 'Docs Writer' }
          ]}
          onSend={() => undefined}
        />
      )

      const textarea = screen.getByLabelText('消息输入框')
      await user.type(textarea, '@')
      expect(screen.getByRole('option', { name: '选择技能 Research' })).toHaveAttribute('aria-selected', 'true')
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }))
      scrollIntoView.mockClear()

      await user.keyboard('{ArrowDown}{Enter}')
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' }))
      expect(textarea).toHaveValue('@Code Review ')

      await user.clear(textarea)
      await user.type(textarea, '@')
      expect(screen.getByRole('listbox', { name: '技能提及建议' })).toBeInTheDocument()
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('listbox', { name: '技能提及建议' })).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: originalScrollIntoView })
    }
  })

  it('keeps literal @ characters out of skill mention suggestions and injection', async () => {
    const user = userEvent.setup()
    const onSend = vi.fn()

    render(
      <Composer
        workspacePath="C:/dev/hesper"
        modelId="mock/hesper-fast"
        skillOptions={[{ id: 'skill-research', name: 'Research', description: 'Find sources' }]}
        onSend={onSend}
      />
    )

    const textarea = screen.getByLabelText('消息输入框')
    await user.type(textarea, 'email@example.com @missing')
    expect(screen.queryByRole('listbox', { name: '技能提及建议' })).not.toBeInTheDocument()

    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onSend).toHaveBeenCalledWith('email@example.com @missing', expect.objectContaining({ thinkingLevel: 'high' }))
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

    await waitFor(() => expect(onSend).toHaveBeenCalledWith('first', expect.objectContaining({ thinkingLevel: 'high' })))
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
    const inlineCode = screen.getByText('inline code')
    expect(inlineCode.tagName).toBe('CODE')
    expect(inlineCode).toHaveStyle({ background: themeTokens.color.softControl, color: themeTokens.color.text })
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

  it('keeps wide markdown tables and code blocks scrolling inside the output instead of the conversation page', () => {
    renderConversationWithAssistant([
      '| Column A | Column B | Column C |',
      '| --- | --- | --- |',
      '| very-long-unbroken-value-that-should-not-widen-the-conversation | another-very-long-unbroken-value-that-stays-inside-the-table | final-wide-value |',
      '',
      '```text',
      'very-long-unbroken-code-line-that-should-scroll-inside-the-code-block-instead-of-the-message-list',
      '```'
    ].join('\n'))

    const messageList = screen.getByLabelText('消息列表')
    expect(messageList).toHaveStyle({ overflowX: 'hidden', overflowY: 'auto' })

    const outputScroller = screen.getByLabelText('输出内容滚动区')
    expect(outputScroller).toHaveStyle({ overflowX: 'hidden', overflowY: 'auto', minWidth: '0px' })

    const outputBlock = outputScroller.closest('.hesper-output-block')
    expect(outputBlock).toHaveStyle({ maxWidth: '100%', minWidth: '0px' })

    const tableScroller = screen.getByRole('table').parentElement
    expect(tableScroller).toHaveAttribute('data-hesper-markdown-table-scroll', 'true')
    expect(tableScroller).toHaveStyle({ maxWidth: '100%', minWidth: '0px', overflowX: 'auto' })

    const codeScroller = screen.getByText(/very-long-unbroken-code-line/).closest('pre')
    expect(codeScroller).toHaveAttribute('data-hesper-markdown-code-scroll', 'true')
    expect(codeScroller).toHaveStyle({ maxWidth: '100%', minWidth: '0px', overflowX: 'auto' })
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

  it('renders markdown code blocks with semantic theme colors', () => {
    render(<OutputBlock content={'```ts\nconst value = 1\n```'} contentType="markdown" />)

    const codeBlock = screen.getByText('const value = 1').closest('pre')
    expect(codeBlock).toHaveStyle({ background: themeTokens.color.codeBackground, color: themeTokens.color.text })
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

  it('lets output block edge wheels continue scrolling the conversation while containing inner scroll', () => {
    const messages = [
      {
        id: 'edge-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: '请生成长输出',
        contentType: 'markdown',
        runId: 'run-edge-1',
        createdAt: now
      },
      {
        id: 'edge-assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: Array.from({ length: 60 }, (_, index) => `可滚动输出第 ${index + 1} 行`).join('\n\n'),
        contentType: 'markdown',
        runId: 'run-edge-1',
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

    const conversationScroller = screen.getByLabelText('消息列表') as HTMLElement
    const outputScroller = screen.getByLabelText('输出内容滚动区') as HTMLElement
    Object.defineProperty(outputScroller, 'clientHeight', { configurable: true, value: 120 })
    Object.defineProperty(outputScroller, 'scrollHeight', { configurable: true, value: 480 })

    conversationScroller.scrollTop = 50
    outputScroller.scrollTop = 120
    fireEvent.wheel(outputScroller, { deltaY: 64 })
    expect(conversationScroller.scrollTop).toBe(50)

    conversationScroller.scrollTop = 140
    outputScroller.scrollTop = 360
    fireEvent.wheel(outputScroller, { deltaY: 80 })
    expect(conversationScroller.scrollTop).toBe(220)

    conversationScroller.scrollTop = 300
    outputScroller.scrollTop = 0
    fireEvent.wheel(outputScroller, { deltaY: -90 })
    expect(conversationScroller.scrollTop).toBe(210)
  })

  it('lets wide markdown tables consume horizontal wheel without scrolling the conversation', () => {
    const messages = [
      {
        id: 'table-user-1',
        sessionId: 'session-1',
        role: 'user',
        content: '请生成宽表格',
        contentType: 'markdown',
        runId: 'run-table-1',
        createdAt: now
      },
      {
        id: 'table-assistant-1',
        sessionId: 'session-1',
        role: 'assistant',
        content: [
          '| 第一列 | 第二列 | 第三列 | 第四列 | 第五列 |',
          '| --- | --- | --- | --- | --- |',
          '| 很长的单元格内容一 | 很长的单元格内容二 | 很长的单元格内容三 | 很长的单元格内容四 | 很长的单元格内容五 |'
        ].join('\n'),
        contentType: 'markdown',
        runId: 'run-table-1',
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

    const conversationScroller = screen.getByLabelText('消息列表') as HTMLElement
    const outputScroller = screen.getByLabelText('输出内容滚动区') as HTMLElement
    const table = screen.getByRole('table')
    const tableScroller = table.closest('.hesper-theme-scrollbar') as HTMLElement
    expect(tableScroller).not.toBe(outputScroller)

    Object.defineProperty(outputScroller, 'clientWidth', { configurable: true, value: 320 })
    Object.defineProperty(outputScroller, 'scrollWidth', { configurable: true, value: 320 })
    Object.defineProperty(outputScroller, 'clientHeight', { configurable: true, value: 120 })
    Object.defineProperty(outputScroller, 'scrollHeight', { configurable: true, value: 120 })
    Object.defineProperty(tableScroller, 'clientWidth', { configurable: true, value: 160 })
    Object.defineProperty(tableScroller, 'scrollWidth', { configurable: true, value: 640 })

    conversationScroller.scrollTop = 25
    conversationScroller.scrollLeft = 10
    tableScroller.scrollLeft = 120

    const horizontalWheel = new WheelEvent('wheel', { deltaX: 80, bubbles: true, cancelable: true })
    tableScroller.dispatchEvent(horizontalWheel)

    expect(horizontalWheel.defaultPrevented).toBe(false)
    expect(conversationScroller.scrollTop).toBe(25)
    expect(conversationScroller.scrollLeft).toBe(10)
  })

  it('scrolls the message list when wheeling over conversation title and message padding chrome', () => {
    render(
      <ConversationView
        session={baseSession}
        messages={[
          {
            id: 'padding-user-1',
            sessionId: 'session-1',
            role: 'user',
            content: '第一条消息',
            contentType: 'markdown',
            createdAt: now
          },
          {
            id: 'padding-assistant-1',
            sessionId: 'session-1',
            role: 'assistant',
            content: '第一条回复',
            contentType: 'markdown',
            createdAt: '2026-06-10T03:00:01.000Z'
          }
        ]}
        steps={[]}
        streamingText=""
        modelId="mock/hesper-fast"
        onSend={() => undefined}
      />
    )

    const conversationScroller = screen.getByLabelText('消息列表') as HTMLElement
    conversationScroller.scrollTop = 0

    fireEvent.wheel(conversationScroller, { deltaY: 42 })
    expect(conversationScroller.scrollTop).toBe(42)

    fireEvent.wheel(screen.getByRole('heading', { name: '测试会话' }), { deltaY: 58 })
    expect(conversationScroller.scrollTop).toBe(100)
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
    expect(dialog).toHaveStyle({ background: themeTokens.color.surface })
    expect(dialog).not.toHaveStyle({ backdropFilter: 'blur(18px) saturate(140%)' })

    const contentShell = screen.getByLabelText('最大化输出内容')
    expect(contentShell).toHaveStyle({ width: '100%', height: '100%', background: 'transparent', borderStyle: 'none' })
    expect(contentShell).not.toHaveStyle({ maxWidth: '1120px' })
    expect(contentShell.style.boxShadow).toBe('')

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

  it('decodes unicode escape sequences in tool output details for readable command results', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        autoExpanded
        steps={[
          {
            id: 'step-tool-unicode-output',
            runId: 'run-unicode-output',
            type: 'tool_call',
            status: 'succeeded',
            title: '执行命令',
            detail: JSON.stringify({
              kind: 'tool_call',
              input: { command: 'mock-command' },
              output: 'stdout: \\u4e2d\\u6587\\u8f93\\u51fa\\nkeep-ascii'
            }),
            createdAt: now
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: '查看步骤详情：执行命令' }))
    const stepDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    expect(within(stepDialog).getByText(/stdout: 中文输出/)).toBeInTheDocument()
    expect(within(stepDialog).queryByText(/\\u4e2d\\u6587/)).not.toBeInTheDocument()
    expect(within(stepDialog).getByText(/keep-ascii/)).toBeInTheDocument()
  })

  it('keeps non-unicode backslash sequences unchanged in tool output details', async () => {
    const user = userEvent.setup()
    render(
      <RunSteps
        autoExpanded
        steps={[
          {
            id: 'step-tool-backslash-output',
            runId: 'run-backslash-output',
            type: 'tool_call',
            status: 'succeeded',
            title: '执行命令',
            detail: JSON.stringify({
              kind: 'tool_call',
              input: { command: 'mock-command' },
              output: 'path: C:\\Users\\oisin\\dev\\hesper\nregex: \\d+'
            }),
            createdAt: now
          }
        ]}
      />
    )

    await user.click(screen.getByRole('button', { name: '查看步骤详情：执行命令' }))
    const stepDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    expect(within(stepDialog).getByText(/path: C:\\Users\\oisin\\dev\\hesper/)).toBeInTheDocument()
    expect(within(stepDialog).getByText(/regex: \\d\+/)).toBeInTheDocument()
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
    expect(within(item).getByText('搜索 Hesper 是什么')).toHaveStyle({ color: themeTokens.color.textMuted })
    expect(within(item).getByText('{"url":"https://example.com"}')).toHaveStyle({ color: themeTokens.color.textMuted })
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
    expect(within(item).getByText('读取 README 了解项目结构')).toHaveStyle({ color: themeTokens.color.textMuted })
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

  it('opens Worker Agent execution details for worker tool steps and renders empty states before child output exists', async () => {
    const user = userEvent.setup()
    const workerInvocation = {
      id: 'worker-invocation-empty',
      parentRunId: 'run-parent',
      parentStepId: 'step-worker-empty',
      task: 'Summarise the implementation status.',
      roleId: 'worker-reviewer',
      allowedToolIds: ['filesystem.read-file', 'git.status'],
      status: 'queued',
      createdAt: now
    } satisfies WorkerAgentInvocation

    render(
      <RunSteps
        steps={[
          {
            id: 'step-worker-empty',
            runId: 'run-parent',
            type: 'tool_call',
            status: 'running',
            title: 'Spawn Worker Agent',
            summary: 'Spawn worker before child run exists',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'agent.spawn-worker-agent', input: { task: workerInvocation.task }, output: 'accepted' }),
            createdAt: now
          }
        ]}
        workerAgentView={{
          invocationsByParentStepId: { 'step-worker-empty': workerInvocation },
          runsById: {},
          stepsByRun: {},
          messagesByRun: {},
          streamingByRun: {}
        } as any}
      />
    )

    await user.click(screen.getByRole('button', { expanded: false }))
    const item = screen.getByRole('listitem')
    await user.click(within(item).getByRole('button', { name: /查看步骤详情/ }))

    const dialog = screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })
    const inputRegion = within(dialog).getByLabelText('Worker Agent 输入')
    const stepsRegion = within(dialog).getByLabelText('Worker Agent 执行步骤')
    const streamingRegion = within(dialog).getByLabelText('Worker Agent 实时输出')
    const finalRegion = within(dialog).getByLabelText('Worker Agent 最终输出')
    const userMessage = within(inputRegion).getByLabelText('用户消息')

    expect(userMessage).toHaveTextContent('Summarise the implementation status.')
    expect(userMessage).toHaveTextContent('worker-reviewer')
    expect(userMessage).toHaveTextContent('filesystem.read-file')
    expect(userMessage).toHaveTextContent('git.status')
    expect(dialog).toHaveTextContent('子运行尚未创建')
    expect(stepsRegion).toHaveTextContent('暂无执行步骤')
    expect(streamingRegion).toHaveTextContent('暂无实时输出')
    expect(finalRegion).toHaveTextContent('暂无最终输出')
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
    const inputRegion = within(dialog).getByLabelText('Worker Agent 输入')
    const stepsRegion = within(dialog).getByLabelText('Worker Agent 执行步骤')
    const streamingRegion = within(dialog).getByLabelText('Worker Agent 实时输出')
    const finalRegion = within(dialog).getByLabelText('Worker Agent 最终输出')
    const userMessage = within(inputRegion).getByLabelText('用户消息')

    expect(userMessage).toHaveTextContent('Review the diff and explain the risk.')
    expect(userMessage).toHaveTextContent('Inspect README before summarising the worker result.')
    expect(userMessage).toHaveTextContent('A concise risk summary with action items.')
    expect(userMessage).toHaveTextContent('worker-reviewer')
    expect(userMessage).toHaveTextContent('filesystem.read-file')
    expect(userMessage).toHaveTextContent('git.status')
    expect(userMessage.parentElement?.parentElement).toHaveStyle({ justifyContent: 'flex-end' })
    expect(stepsRegion.compareDocumentPosition(inputRegion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(streamingRegion.compareDocumentPosition(stepsRegion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(finalRegion.compareDocumentPosition(stepsRegion) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(within(stepsRegion).getByRole('button', { name: '查看步骤详情：Read File' })).toHaveTextContent('Inspect README')
    expect(streamingRegion).toHaveTextContent('streaming child output')
    expect(finalRegion).toHaveTextContent('final worker answer')
    expect(within(dialog).queryByText('Input')).not.toBeInTheDocument()

    await user.click(within(streamingRegion).getByRole('button', { name: '全屏查看输出' }))
    const outputDialog = screen.getByRole('dialog', { name: '输出全屏查看' })
    fireEvent.keyDown(outputDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: '输出全屏查看' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })).toBeInTheDocument()

    await user.click(within(stepsRegion).getByRole('button', { name: '查看步骤详情：Read File' }))
    const innerDialog = screen.getByRole('dialog', { name: '步骤全屏查看' })
    fireEvent.keyDown(innerDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: '步骤全屏查看' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })).toBeInTheDocument()

    const outerDialog = screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })
    fireEvent.keyDown(outerDialog, { key: 'Escape', bubbles: true, cancelable: true })
    expect(screen.queryByRole('dialog', { name: 'Worker Agent 执行详情' })).not.toBeInTheDocument()
  })

  it('renders Worker Agent streaming output as markdown when final output is html', async () => {
    const user = userEvent.setup()
    const workerInvocation = {
      id: 'worker-invocation-html-output',
      parentRunId: 'run-parent',
      parentStepId: 'step-worker-html-output',
      childRunId: 'run-child-html-output',
      task: 'Render html final output.',
      roleId: 'worker-renderer',
      allowedToolIds: [],
      status: 'running',
      createdAt: now
    } satisfies WorkerAgentInvocation
    const childRun = {
      id: 'run-child-html-output',
      sessionId: 'session-1',
      parentRunId: 'run-parent',
      workerAgentInvocationId: 'worker-invocation-html-output',
      status: 'running',
      modelId: 'mock/hesper-fast',
      retryCount: 0,
      maxRetries: 2,
      startedAt: now
    }
    const htmlFinalMessage = {
      id: 'message-child-html-final',
      sessionId: 'session-1',
      role: 'assistant',
      content: '<main><h1>Final HTML output</h1></main>',
      contentType: 'html',
      runId: 'run-child-html-output',
      createdAt: '2026-06-10T03:00:03.000Z'
    } satisfies Message

    render(
      <RunSteps
        steps={[
          {
            id: 'step-worker-html-output',
            runId: 'run-parent',
            type: 'tool_call',
            status: 'running',
            title: 'Spawn Worker Agent',
            summary: 'Spawn worker to render html output',
            detail: JSON.stringify({ kind: 'tool_call', toolId: 'agent.spawn-worker-agent', input: { task: workerInvocation.task }, output: 'accepted' }),
            createdAt: now
          }
        ]}
        workerAgentView={{
          invocationsByParentStepId: { 'step-worker-html-output': workerInvocation },
          runsById: { 'run-child-html-output': childRun },
          stepsByRun: {},
          messagesByRun: { 'run-child-html-output': [htmlFinalMessage] },
          streamingByRun: { 'run-child-html-output': '<h1>Streaming HTML should stay text</h1>' }
        } as any}
      />
    )

    await user.click(screen.getByRole('button', { expanded: false }))
    const item = screen.getByRole('listitem')
    await user.click(within(item).getByRole('button', { name: /查看步骤详情/ }))

    const dialog = screen.getByRole('dialog', { name: 'Worker Agent 执行详情' })
    const streamingRegion = within(dialog).getByLabelText('Worker Agent 实时输出')
    const finalRegion = within(dialog).getByLabelText('Worker Agent 最终输出')

    expect(streamingRegion).toHaveTextContent('<h1>Streaming HTML should stay text</h1>')
    expect(within(streamingRegion).queryByTitle('HTML 输出预览')).not.toBeInTheDocument()
    expect(within(finalRegion).getByTitle('HTML 输出预览')).toHaveAttribute('srcdoc', expect.stringContaining('Final HTML output'))
  })
})
