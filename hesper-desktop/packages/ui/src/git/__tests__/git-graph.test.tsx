import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitGraphFullscreen, themeTokens, type GitCommitDetailView, type GitGraphRowView } from '../..'

const firstRow: GitGraphRowView = {
  commitHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  shortHash: 'aaaaaaa',
  parents: ['bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'],
  subject: 'Add git graph panel',
  authorName: 'Oisin',
  authorEmail: 'oisin@example.com',
  authoredAt: '2026-06-26T04:00:00.000Z',
  refs: [
    { name: 'refs/heads/feature/git-log-panel', shortName: 'feature/git-log-panel', type: 'local-branch' },
    { name: 'refs/tags/v1.2.3', shortName: 'v1.2.3', type: 'tag' }
  ],
  graph: {
    lanes: [
      { id: 'main', active: true },
      { id: 'feature', active: true }
    ],
    nodeLaneId: 'feature',
    edges: [{ fromLaneId: 'main', toLaneId: 'feature' }]
  }
}

const rows: GitGraphRowView[] = [firstRow]

const detail: GitCommitDetailView = {
  commitHash: firstRow.commitHash,
  shortHash: firstRow.shortHash,
  parents: firstRow.parents,
  subject: firstRow.subject,
  body: 'Implements the graph table UI.',
  authorName: firstRow.authorName,
  authorEmail: firstRow.authorEmail,
  authoredAt: firstRow.authoredAt,
  committerName: 'Committer',
  committerEmail: 'committer@example.com',
  committedAt: '2026-06-26T04:05:00.000Z',
  refs: firstRow.refs,
  files: [{ path: 'packages/ui/src/git/GitGraphTable.tsx', status: 'M', additions: 120, deletions: 4 }]
}

const renderGraph = (props: Partial<Parameters<typeof GitGraphFullscreen>[0]> = {}) => {
  const callbacks = {
    onClose: vi.fn(),
    onSelectCommit: vi.fn(),
    onLoadCommitDetail: vi.fn(),
    onCreateBranch: vi.fn(),
    onCreateTag: vi.fn(),
    onCheckout: vi.fn(),
    onCopyCommitId: vi.fn()
  }

  render(
    <GitGraphFullscreen
      open
      rows={rows}
      selectedCommit={firstRow.commitHash}
      detail={detail}
      {...callbacks}
      {...props}
    />
  )

  return callbacks
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('GitGraphFullscreen', () => {
  it('renders the graph table headers', () => {
    renderGraph()

    expect(screen.getByRole('columnheader', { name: '图谱' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '描述' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '日期' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '作者' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '提交' })).toBeInTheDocument()
  })

  it('renders branch and tag refs before the commit message', () => {
    renderGraph()

    const description = screen.getByLabelText('提交描述')
    expect(description.textContent).toMatch(/^feature\/git-log-panelv1\.2\.3Add git graph panel/)
  })

  it('centers graph lanes and nodes on the same lane x coordinate', () => {
    renderGraph()

    const lane = screen.getByTestId('git-graph-lane-feature')
    const node = screen.getByTestId('git-graph-node-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')

    expect(lane.style.left).toBe('var(--git-graph-lane-x)')
    expect(node.style.left).toBe('var(--git-graph-lane-x)')
    expect(lane.style.getPropertyValue('--git-graph-lane-x')).toBe(node.style.getPropertyValue('--git-graph-lane-x'))
    expect(lane).toHaveStyle({ transform: 'translateX(-50%)' })
    expect(node).toHaveStyle({ transform: 'translate(-50%, -50%)' })
  })

  it('opens the commit context menu from a right click and shows all actions', () => {
    renderGraph()

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))

    const menu = screen.getByRole('menu', { name: '提交操作' })
    expect(within(menu).getByRole('menuitem', { name: '从选中提交新建分支' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '创建标签' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '检出此提交' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '复制 Commit ID' })).toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: '查看提交详情' })).toBeInTheDocument()
  })

  it('opens the temporary detail drawer from the menu or Enter', async () => {
    const callbacks = renderGraph()
    const user = userEvent.setup()

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))
    await user.click(screen.getByRole('menuitem', { name: '查看提交详情' }))

    expect(callbacks.onLoadCommitDetail).toHaveBeenCalledWith(firstRow.commitHash)
    expect(screen.getByRole('dialog', { name: '提交详情' })).toHaveTextContent('Implements the graph table UI.')

    await user.click(screen.getByRole('button', { name: '关闭提交详情' }))
    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })

    expect(callbacks.onLoadCommitDetail).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('dialog', { name: '提交详情' })).toBeInTheDocument()
  })

  it('closes Escape in menu, detail drawer, fullscreen order', () => {
    const callbacks = renderGraph()

    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })
    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '提交操作' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '提交详情' })).toBeInTheDocument()
    expect(callbacks.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '提交详情' })).not.toBeInTheDocument()
    expect(callbacks.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  })

  it('invokes callbacks from context menu actions', async () => {
    const callbacks = renderGraph()
    const user = userEvent.setup()
    const openMenu = () => fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))

    openMenu()
    await user.click(screen.getByRole('menuitem', { name: '从选中提交新建分支' }))
    expect(callbacks.onCreateBranch).toHaveBeenCalledWith(firstRow.commitHash)

    openMenu()
    await user.click(screen.getByRole('menuitem', { name: '创建标签' }))
    expect(callbacks.onCreateTag).toHaveBeenCalledWith(firstRow.commitHash)

    openMenu()
    await user.click(screen.getByRole('menuitem', { name: '检出此提交' }))
    expect(callbacks.onCheckout).toHaveBeenCalledWith(firstRow.commitHash)

    openMenu()
    await user.click(screen.getByRole('menuitem', { name: '复制 Commit ID' }))
    expect(callbacks.onCopyCommitId).toHaveBeenCalledWith(firstRow.commitHash)

    openMenu()
    await user.click(screen.getByRole('menuitem', { name: '查看提交详情' }))
    expect(callbacks.onLoadCommitDetail).toHaveBeenCalledWith(firstRow.commitHash)
  })

  it('uses theme tokens for fullscreen, table, row, menu, and drawer styles', () => {
    renderGraph()

    const fullscreen = screen.getByRole('dialog', { name: 'Git 提交图谱' })
    expect(fullscreen).toHaveStyle({ background: themeTokens.color.surface, color: themeTokens.color.text })
    expect(screen.getByRole('table', { name: 'Git 提交图谱表格' })).toHaveStyle({ background: themeTokens.color.surface })
    expect(screen.getByRole('row', { name: /Add git graph panel/ })).toHaveStyle({ background: themeTokens.color.hover })

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))
    const menu = screen.getByRole('menu', { name: '提交操作' })
    expect(menu).toHaveStyle({ background: themeTokens.color.surfaceMuted })
    expect(menu.style.borderColor).toBe(themeTokens.color.border)

    fireEvent.keyDown(window, { key: 'Escape' })
    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })
    const drawer = screen.getByRole('dialog', { name: '提交详情' })
    expect(drawer).toHaveStyle({ background: themeTokens.color.surface })
    expect(drawer.style.borderColor).toBe(themeTokens.color.border)
  })
})
