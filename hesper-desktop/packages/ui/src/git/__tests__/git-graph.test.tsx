import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
      { id: 'main', active: true, topActive: true, bottomActive: true },
      { id: 'feature', active: true, topActive: false, bottomActive: true }
    ],
    nodeLaneId: 'main',
    edges: [{ fromLaneId: 'main', toLaneId: 'feature', fromPosition: 'center', toPosition: 'bottom' }]
  }
}

const secondRow: GitGraphRowView = {
  commitHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  shortHash: 'bbbbbbb',
  parents: [],
  subject: 'Prepare base history',
  authorName: 'Morgan',
  authorEmail: 'morgan@example.com',
  authoredAt: '2026-06-26T03:00:00.000Z',
  refs: [{ name: 'refs/heads/main', shortName: 'main', type: 'local-branch' }],
  graph: {
    lanes: [
      { id: 'main', active: true },
      { id: 'feature', active: false }
    ],
    nodeLaneId: 'main'
  }
}

const rows: GitGraphRowView[] = [firstRow, secondRow]

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

  it('allocates a wider graph column for many lanes and lets users resize data columns', () => {
    const manyLaneRow: GitGraphRowView = {
      ...firstRow,
      graph: {
        lanes: Array.from({ length: 12 }, (_, index) => ({ id: `lane-${index}`, active: true, topActive: true, bottomActive: true })),
        nodeLaneId: 'lane-11'
      }
    }
    renderGraph({ rows: [manyLaneRow] })

    const overlay = screen.getByTestId('git-graph-overlay')
    const graphCol = screen.getByTestId('git-graph-col')
    expect(Number.parseFloat(graphCol.style.width)).toBeGreaterThanOrEqual(244)
    expect(overlay.getAttribute('viewBox')).toContain(`0 0 ${graphCol.style.width.replace('px', '')}`)

    const descriptionCol = screen.getByTestId('git-graph-description-col')
    const initialWidth = Number.parseFloat(descriptionCol.style.width)
    fireEvent.mouseDown(screen.getByRole('button', { name: '调整描述列宽' }), { clientX: 100 })
    fireEvent.mouseMove(window, { clientX: 180 })
    fireEvent.mouseUp(window)

    expect(Number.parseFloat(descriptionCol.style.width)).toBeGreaterThan(initialWidth)
  })

  it('renders branch and tag refs before the commit message with graph-colored branch badges', () => {
    renderGraph()

    const row = screen.getByRole('row', { name: /Add git graph panel/ })
    const description = within(row).getByLabelText('提交描述')
    expect(description.textContent).toMatch(/^feature\/git-log-panelv1\.2\.3Add git graph panel/)
    expect(within(description).getByText('feature/git-log-panel')).toHaveStyle({
      borderColor: '#dc2626',
      background: 'rgba(220, 38, 38, 0.18)'
    })
    expect(within(description).getByText('v1.2.3')).not.toHaveStyle({ borderColor: '#dc2626' })
  })

  it('shows repository-specific summary information in the top-left header', () => {
    renderGraph({ repositoryName: 'hesper-desktop', currentBranch: 'feature/git-log-panel', commitCount: 1234, loadedCount: 60, hasMore: true })

    expect(screen.getByRole('heading', { name: 'hesper-desktop' })).toBeInTheDocument()
    expect(screen.getByLabelText('提交次数')).toHaveTextContent('1,234 次提交')
    expect(screen.queryByText(/已加载/)).not.toBeInTheDocument()
    expect(screen.queryByText(/历史已加载完|正在加载历史|可继续加载/)).not.toBeInTheDocument()
    expect(screen.queryByText('Repository history')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Git 提交图谱' })).not.toBeInTheDocument()
  })

  it('draws continuous graph lanes and smooth branch curves', () => {
    renderGraph()

    const mainLane = screen.getByTestId('git-graph-lane-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-main')
    const featureNode = screen.getByTestId('git-graph-node-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    const edge = screen.getByTestId('git-graph-edge-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-main-feature')

    expect(mainLane).toHaveAttribute('x1', featureNode.getAttribute('cx'))
    expect(mainLane).toHaveAttribute('x2', featureNode.getAttribute('cx'))
    expect(mainLane).toHaveAttribute('y1', '0')
    expect(Number(mainLane.getAttribute('y2'))).toBe(42)
    expect(screen.queryByTestId('git-graph-lane-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-feature')).not.toBeInTheDocument()
    expect(edge.getAttribute('d')).toContain(' L ')
    expect(edge.getAttribute('d')).not.toContain(' C ')
    expect(edge.getAttribute('d')).toMatch(/21 L \d+ 42$/)
    expect(edge.style.fill).toBe('none')
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

  it('opens the context menu from keyboard and restores focus on Escape', async () => {
    renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    row.focus()
    fireEvent.keyDown(row, { key: 'ContextMenu' })

    const firstItem = screen.getByRole('menuitem', { name: '从选中提交新建分支' })
    await waitFor(() => expect(firstItem).toHaveFocus())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '提交操作' })).not.toBeInTheDocument()
    await waitFor(() => expect(row).toHaveFocus())

    fireEvent.keyDown(row, { key: 'F10', shiftKey: true })
    await waitFor(() => expect(screen.getByRole('menuitem', { name: '从选中提交新建分支' })).toHaveFocus())
  })

  it('supports Arrow/Home/End navigation in the context menu', async () => {
    renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    row.focus()
    fireEvent.keyDown(row, { key: 'ContextMenu' })
    const items = screen.getAllByRole('menuitem')

    await waitFor(() => expect(items[0]).toHaveFocus())
    fireEvent.keyDown(screen.getByRole('menu', { name: '提交操作' }), { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu', { name: '提交操作' }), { key: 'End' })
    expect(items[4]).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu', { name: '提交操作' }), { key: 'ArrowUp' })
    expect(items[3]).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('menu', { name: '提交操作' }), { key: 'Home' })
    expect(items[0]).toHaveFocus()
  })

  it('keeps context menu item highlighted after mouse leaves while it remains focused', async () => {
    renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    row.focus()
    fireEvent.keyDown(row, { key: 'ContextMenu' })

    const firstItem = screen.getByRole('menuitem', { name: '从选中提交新建分支' })
    await waitFor(() => expect(firstItem).toHaveFocus())

    fireEvent.mouseEnter(firstItem)
    fireEvent.mouseLeave(firstItem)

    expect(firstItem).toHaveFocus()
    expect(firstItem).toHaveStyle({ background: themeTokens.color.hover })
  })

  it('clamps the context menu inside the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
    renderGraph()

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }), { clientX: 790, clientY: 590 })

    const menu = screen.getByRole('menu', { name: '提交操作' })
    expect(Number.parseInt(menu.style.left, 10)).toBeLessThanOrEqual(572)
    expect(Number.parseInt(menu.style.top, 10)).toBeLessThanOrEqual(402)
  })

  it('closes the context menu on outside click or focus loss', async () => {
    renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    fireEvent.contextMenu(row)
    expect(screen.getByRole('menu', { name: '提交操作' })).toBeInTheDocument()
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu', { name: '提交操作' })).not.toBeInTheDocument())

    fireEvent.contextMenu(row)
    expect(screen.getByRole('menu', { name: '提交操作' })).toBeInTheDocument()
    screen.getByRole('button', { name: '关闭 Git 提交图谱' }).focus()
    await waitFor(() => expect(screen.queryByRole('menu', { name: '提交操作' })).not.toBeInTheDocument())
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

  it('updates the open detail drawer when selecting another commit on the left', async () => {
    const callbacks = renderGraph()
    const user = userEvent.setup()

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))
    await user.click(screen.getByRole('menuitem', { name: '查看提交详情' }))
    expect(screen.getByRole('dialog', { name: '提交详情' })).toHaveTextContent('Add git graph panel')

    await user.click(screen.getByRole('row', { name: /Prepare base history/ }))

    expect(callbacks.onSelectCommit).toHaveBeenCalledWith(secondRow.commitHash)
    expect(callbacks.onLoadCommitDetail).toHaveBeenLastCalledWith(secondRow.commitHash)
    expect(screen.getByRole('dialog', { name: '提交详情' })).toHaveTextContent('Prepare base history')
  })

  it('closes Escape in menu, detail drawer, fullscreen order', async () => {
    const callbacks = renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    row.focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭提交详情' })).toHaveFocus())
    fireEvent.contextMenu(row)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: '提交操作' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: '提交详情' })).toBeInTheDocument()
    expect(callbacks.onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: '提交详情' })).not.toBeInTheDocument()
    expect(callbacks.onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(row).toHaveFocus())

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callbacks.onClose).toHaveBeenCalledTimes(1)
  })

  it('sets initial fullscreen focus, uses Space for row selection, and removes Escape listener when closed', async () => {
    const callbacks = renderGraph()
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    await waitFor(() => expect(row).toHaveFocus())
    fireEvent.keyDown(row, { key: ' ' })
    expect(callbacks.onSelectCommit).toHaveBeenCalledWith(firstRow.commitHash)

    cleanup()
    const closedCallbacks = renderGraph({ open: false })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(closedCallbacks.onClose).not.toHaveBeenCalled()
  })

  it('uses ArrowDown and ArrowUp to select adjacent commits and move row focus', async () => {
    const callbacks = renderGraph()
    const first = screen.getByRole('row', { name: /Add git graph panel/ })
    const second = screen.getByRole('row', { name: /Prepare base history/ })

    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'ArrowDown' })

    expect(callbacks.onSelectCommit).toHaveBeenCalledWith(secondRow.commitHash)
    expect(second).toHaveFocus()

    fireEvent.keyDown(second, { key: 'ArrowUp' })

    expect(callbacks.onSelectCommit).toHaveBeenLastCalledWith(firstRow.commitHash)
    expect(first).toHaveFocus()
  })

  it('does not re-select the current commit at ArrowUp or ArrowDown boundaries', async () => {
    const callbacks = renderGraph()
    const first = screen.getByRole('row', { name: /Add git graph panel/ })
    const second = screen.getByRole('row', { name: /Prepare base history/ })

    await waitFor(() => expect(first).toHaveFocus())
    fireEvent.keyDown(first, { key: 'ArrowUp' })

    expect(callbacks.onSelectCommit).not.toHaveBeenCalled()
    expect(first).toHaveFocus()

    second.focus()
    callbacks.onSelectCommit.mockClear()
    fireEvent.keyDown(second, { key: 'ArrowDown' })

    expect(callbacks.onSelectCommit).not.toHaveBeenCalled()
    expect(second).toHaveFocus()
  })

  it('updates aria-selected and selected styling when parent controls ArrowDown selection', async () => {
    const ControlledGraph = () => {
      const [selectedCommit, setSelectedCommit] = useState(firstRow.commitHash)
      return (
        <GitGraphFullscreen
          open
          rows={rows}
          selectedCommit={selectedCommit}
          detail={detail}
          onClose={vi.fn()}
          onSelectCommit={setSelectedCommit}
          onLoadCommitDetail={vi.fn()}
          onCreateBranch={vi.fn()}
          onCreateTag={vi.fn()}
          onCheckout={vi.fn()}
          onCopyCommitId={vi.fn()}
        />
      )
    }

    render(<ControlledGraph />)
    const first = screen.getByRole('row', { name: /Add git graph panel/ })
    const second = screen.getByRole('row', { name: /Prepare base history/ })

    await waitFor(() => expect(first).toHaveFocus())
    expect(first).toHaveAttribute('aria-selected', 'true')
    expect(second).toHaveAttribute('aria-selected', 'false')

    fireEvent.keyDown(first, { key: 'ArrowDown' })

    await waitFor(() => expect(second).toHaveAttribute('aria-selected', 'true'))
    expect(first).toHaveAttribute('aria-selected', 'false')
    expect(second).toHaveStyle({ background: themeTokens.color.hover })
  })

  it('loads more commits when scrolling near the bottom and more history exists', () => {
    const onLoadMore = vi.fn()
    renderGraph({ hasMore: true, loadedCount: rows.length, onLoadMore })

    const content = screen.getByRole('main', { name: 'Git 图谱内容' })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(content, 'scrollTop', { configurable: true, value: 80 })

    fireEvent.scroll(content)
    expect(onLoadMore).not.toHaveBeenCalled()

    Object.defineProperty(content, 'scrollTop', { configurable: true, value: 340 })
    fireEvent.scroll(content)
    expect(onLoadMore).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent('继续向下滚动加载更多')
  })

  it('does not load more while a pagination request is already running', () => {
    const onLoadMore = vi.fn()
    renderGraph({ hasMore: true, loadingMore: true, onLoadMore })

    const content = screen.getByRole('main', { name: 'Git 图谱内容' })
    Object.defineProperty(content, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(content, 'clientHeight', { configurable: true, value: 600 })
    Object.defineProperty(content, 'scrollTop', { configurable: true, value: 380 })

    fireEvent.scroll(content)
    expect(onLoadMore).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('正在加载更多提交')
  })

  it('moves focus from an external opener into the fullscreen dialog on open', async () => {
    const callbacks = {
      onClose: vi.fn(),
      onSelectCommit: vi.fn(),
      onLoadCommitDetail: vi.fn(),
      onCreateBranch: vi.fn(),
      onCreateTag: vi.fn(),
      onCheckout: vi.fn(),
      onCopyCommitId: vi.fn()
    }
    const view = (open: boolean) => (
      <>
        <button type="button">外部打开按钮</button>
        <GitGraphFullscreen
          open={open}
          rows={rows}
          selectedCommit={firstRow.commitHash}
          detail={detail}
          {...callbacks}
        />
      </>
    )
    const { rerender } = render(view(false))
    const externalButton = screen.getByRole('button', { name: '外部打开按钮' })

    externalButton.focus()
    expect(externalButton).toHaveFocus()

    rerender(view(true))
    const row = screen.getByRole('row', { name: /Add git graph panel/ })

    await waitFor(() => expect(row).toHaveFocus())
    expect(externalButton).not.toHaveFocus()
  })

  it('keeps file change status, path, and diff stats in separate non-overlapping columns', () => {
    renderGraph({
      detail: {
        ...detail,
        files: [{
          path: 'hesper-desktop/packages/app-core/src/__tests__/settings-service.test.ts',
          status: 'modified',
          additions: 17,
          deletions: 11
        }]
      }
    })

    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })

    const status = screen.getByText('modified')
    const fileItem = status.closest('li')
    expect(fileItem).toHaveStyle({ gridTemplateColumns: '72px minmax(0, 1fr) max-content' })
    expect(status).toHaveStyle({ minWidth: '72px' })
  })

  it('keeps dt and dd inside a description list in the drawer', () => {
    renderGraph()

    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })

    const summary = screen.getByRole('region', { name: '提交摘要' })
    const descriptionList = within(summary).getByRole('list', { name: '提交元数据' })
    const term = within(descriptionList).getByText('Full hash')
    const value = within(descriptionList).getByText(firstRow.commitHash)
    expect(term.closest('dl')).toBe(descriptionList)
    expect(value.closest('dl')).toBe(descriptionList)
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
    const table = screen.getByRole('table', { name: 'Git 提交图谱表格' })
    expect(table).toHaveStyle({ background: themeTokens.color.surface, color: themeTokens.color.text })
    expect(screen.getByRole('columnheader', { name: '描述' }).closest('thead')).toHaveStyle({ background: themeTokens.color.surfaceMuted, color: themeTokens.color.textMuted })
    expect(screen.getByRole('columnheader', { name: '描述' }).style.borderBottom).toContain(themeTokens.color.borderSubtle)
    expect(screen.getByRole('row', { name: /Add git graph panel/ })).toHaveStyle({ background: themeTokens.color.hover, color: themeTokens.color.text })
    expect(screen.getByRole('cell', { name: firstRow.shortHash })).toHaveStyle({ color: themeTokens.color.textMuted })

    fireEvent.contextMenu(screen.getByRole('row', { name: /Add git graph panel/ }))
    const menu = screen.getByRole('menu', { name: '提交操作' })
    expect(menu).toHaveStyle({ background: themeTokens.color.surfaceMuted, color: themeTokens.color.text })
    expect(menu.style.borderColor).toBe(themeTokens.color.borderSubtle)
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: '从选中提交新建分支' }))
    expect(screen.getByRole('menuitem', { name: '从选中提交新建分支' })).toHaveStyle({ background: themeTokens.color.hover })

    fireEvent.keyDown(window, { key: 'Escape' })
    screen.getByRole('row', { name: /Add git graph panel/ }).focus()
    fireEvent.keyDown(document.activeElement ?? window, { key: 'Enter' })
    const drawer = screen.getByRole('dialog', { name: '提交详情' })
    expect(drawer).toHaveStyle({ background: themeTokens.color.surface, color: themeTokens.color.text })
    expect(drawer.style.borderColor).toBe(themeTokens.color.borderSubtle)
    expect(within(drawer).queryByText('Commit detail')).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '新建分支' })).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '创建标签' })).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '检出' })).not.toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: '复制 ID' })).not.toBeInTheDocument()
  })

})
