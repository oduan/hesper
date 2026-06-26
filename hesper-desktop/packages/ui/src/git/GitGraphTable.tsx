import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from 'react'
import { themeTokens } from '../theme'
import { GitRefBadge } from './GitRefBadge'
import type { GitGraphLaneView, GitGraphRowView } from './git-graph-types'

export type GitCommitMenuRequest = {
  commitHash: string
  x: number
  y: number
  triggerElement?: HTMLElement | undefined
}

export type GitGraphTableProps = {
  rows: GitGraphRowView[]
  selectedCommit?: string | undefined
  onSelectCommit: (commitHash: string) => void
  onOpenContextMenu: (request: GitCommitMenuRequest) => void
  onOpenDetail: (commitHash: string) => void
}

const graphColumnMinWidth = 192
const laneGap = 18
const laneInset = 18
const rowHeight = 42
const headerHeight = 36
const nodeRadius = 6

type ResizableColumnKey = 'description' | 'date' | 'author' | 'commit'

const defaultColumnWidths: Record<ResizableColumnKey, number> = {
  description: 560,
  date: 150,
  author: 180,
  commit: 120
}

const minColumnWidths: Record<ResizableColumnKey, number> = {
  description: 260,
  date: 112,
  author: 120,
  commit: 88
}

const columnLabels: Record<ResizableColumnKey, string> = {
  description: '描述',
  date: '日期',
  author: '作者',
  commit: '提交'
}

export function GitGraphTable({ rows, selectedCommit, onSelectCommit, onOpenContextMenu, onOpenDetail }: GitGraphTableProps) {
  const [columnWidths, setColumnWidths] = useState(defaultColumnWidths)
  const graphWidth = graphColumnWidthForRows(rows)
  const totalTableWidth = graphWidth + Object.values(columnWidths).reduce((sum, width) => sum + width, 0)

  const startColumnResize = (column: ResizableColumnKey, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    const startWidth = columnWidths[column]

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const nextWidth = Math.max(minColumnWidths[column], startWidth + moveEvent.clientX - startX)
      setColumnWidths((current) => ({ ...current, [column]: nextWidth }))
    }

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  const resizeColumnByKeyboard = (column: ResizableColumnKey, event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const delta = event.key === 'ArrowRight' ? 24 : -24
    setColumnWidths((current) => ({
      ...current,
      [column]: Math.max(minColumnWidths[column], current[column] + delta)
    }))
  }

  const renderResizableHeader = (column: ResizableColumnKey) => (
    <th scope="col" aria-label={columnLabels[column]} style={headerCellStyle}>
      <span>{columnLabels[column]}</span>
      <button
        type="button"
        aria-label={`调整${columnLabels[column]}列宽`}
        style={resizeHandleStyle}
        onMouseDown={(event) => startColumnResize(column, event)}
        onKeyDown={(event) => resizeColumnByKeyboard(column, event)}
      />
    </th>
  )

  return (
    <div style={tableFrameStyle}>
      <GraphOverlay rows={rows} graphWidth={graphWidth} />
      <table role="table" aria-label="Git 提交图谱表格" style={{ ...tableStyle, minWidth: totalTableWidth }}>
        <colgroup>
          <col data-testid="git-graph-col" style={{ width: graphWidth }} />
          <col data-testid="git-graph-description-col" style={{ width: columnWidths.description }} />
          <col data-testid="git-graph-date-col" style={{ width: columnWidths.date }} />
          <col data-testid="git-graph-author-col" style={{ width: columnWidths.author }} />
          <col data-testid="git-graph-commit-col" style={{ width: columnWidths.commit }} />
        </colgroup>
        <thead style={tableHeadStyle}>
          <tr>
            <th scope="col" style={{ ...headerCellStyle, ...graphHeaderCellStyle(graphWidth) }}>图谱</th>
            {renderResizableHeader('description')}
            {renderResizableHeader('date')}
            {renderResizableHeader('author')}
            {renderResizableHeader('commit')}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const selected = selectedCommit === row.commitHash
            const graphColor = rowNodeColor(row)
            return (
              <tr
                key={row.commitHash}
                tabIndex={0}
                aria-selected={selected}
                aria-label={`${row.subject} ${row.shortHash}`}
                data-git-commit-hash={row.commitHash}
                style={selected ? selectedRowStyle : rowStyle}
                onClick={() => onSelectCommit(row.commitHash)}
                onContextMenu={(event) => handleContextMenu(event, row.commitHash, onSelectCommit, onOpenContextMenu)}
                onKeyDown={(event) => handleRowKeyDown(event, rowIndex, rows, onSelectCommit, onOpenDetail, onOpenContextMenu)}
              >
                <td aria-hidden="true" style={{ ...cellStyle, ...graphCellStyle }} />
                <td style={{ ...cellStyle, ...descriptionCellStyle }}>
                  <span aria-label="提交描述" style={descriptionContentStyle}>
                    {row.refs.map((ref) => <GitRefBadge key={`${ref.type}-${ref.name}`} refView={ref} graphColor={graphColor} />)}
                    <span style={subjectStyle}>{row.subject}</span>
                  </span>
                </td>
                <td style={{ ...cellStyle, ...dateCellStyle }}>{formatDate(row.authoredAt)}</td>
                <td style={{ ...cellStyle, ...authorCellStyle }} title={row.authorEmail}>{row.authorName}</td>
                <td style={{ ...cellStyle, ...commitCellStyle }}>{row.shortHash}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function GraphOverlay({ rows, graphWidth }: { rows: GitGraphRowView[]; graphWidth: number }) {
  if (rows.length === 0) return null

  const svgHeight = rows.length * rowHeight

  return (
    <svg
      data-testid="git-graph-overlay"
      aria-hidden="true"
      viewBox={`0 0 ${graphWidth} ${svgHeight}`}
      preserveAspectRatio="none"
      style={{ ...graphOverlayStyle(graphWidth), height: svgHeight }}
    >
      {rows.flatMap((row, rowIndex) => normalizedLanes(row).flatMap((lane, lanePosition) => {
        const segment = laneSegment(rowIndex, lane, row.graph.nodeLaneId)
        if (!segment) return []
        const x = laneInset + lanePosition * laneGap
        return [
          <line
            key={`lane-${row.commitHash}-${lane.id}`}
            data-testid={`git-graph-lane-${row.commitHash}-${lane.id}`}
            x1={x}
            x2={x}
            y1={segment.y1}
            y2={segment.y2}
            style={laneSvgStyle(lane, lanePosition)}
            vectorEffect="non-scaling-stroke"
          />
        ]
      }))}
      {rows.flatMap((row, rowIndex) => (row.graph.edges ?? []).flatMap((edge, edgeIndex) => {
        const lanes = normalizedLanes(row)
        const fromIndex = laneIndex(lanes, edge.fromLaneId)
        const toIndex = laneIndex(lanes, edge.toLaneId)
        if (fromIndex === toIndex) return []

        const fromX = laneInset + fromIndex * laneGap
        const toX = laneInset + toIndex * laneGap
        const fromPosition = edge.fromPosition ?? 'center'
        const toPosition = edge.toPosition ?? 'bottom'
        const path = edgePath(rowIndex, fromX, toX, fromPosition, toPosition)
        const colorIndex = toPosition === 'center' ? fromIndex : toIndex
        return [
          <path
            key={`edge-${row.commitHash}-${edge.fromLaneId}-${edge.toLaneId}-${edgeIndex}`}
            data-testid={`git-graph-edge-${row.commitHash}-${edge.fromLaneId}-${edge.toLaneId}`}
            d={path}
            style={edgeSvgStyle(lanes[colorIndex], colorIndex)}
            vectorEffect="non-scaling-stroke"
          />
        ]
      }))}
      {rows.map((row, rowIndex) => {
        const lanes = normalizedLanes(row)
        const nodeLaneId = row.graph.nodeLaneId ?? lanes.find((lane) => lane.active)?.id ?? lanes[0]?.id
        if (!nodeLaneId) return null
        const nodeIndex = laneIndex(lanes, nodeLaneId)
        const lane = lanes[nodeIndex] ?? { id: nodeLaneId, active: true }
        return (
          <circle
            key={`node-${row.commitHash}`}
            data-testid={`git-graph-node-${row.commitHash}`}
            cx={laneInset + nodeIndex * laneGap}
            cy={rowCenterY(rowIndex)}
            r={nodeRadius}
            style={nodeSvgStyle(lane, nodeIndex)}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </svg>
  )
}

const normalizedLanes = (row: GitGraphRowView): GitGraphLaneView[] => (
  row.graph.lanes.length > 0 ? row.graph.lanes : [{ id: 'default', active: true }]
)

const graphColumnWidthForRows = (rows: GitGraphRowView[]) => {
  const laneCount = Math.max(1, ...rows.map((row) => normalizedLanes(row).length))
  return Math.max(graphColumnMinWidth, laneInset * 2 + (laneCount - 1) * laneGap + nodeRadius * 4)
}

const rowCenterY = (rowIndex: number) => rowIndex * rowHeight + rowHeight / 2

const laneSegment = (rowIndex: number, lane: GitGraphLaneView, nodeLaneId?: string): { y1: number; y2: number } | undefined => {
  const topActive = lane.topActive ?? lane.active
  const bottomActive = lane.bottomActive ?? lane.active
  if (!topActive && !bottomActive) return undefined

  const rowTop = rowIndex * rowHeight
  const rowBottom = (rowIndex + 1) * rowHeight
  const center = rowCenterY(rowIndex)
  const isNodeLane = lane.id === nodeLaneId

  if (topActive && bottomActive) return { y1: rowTop, y2: rowBottom }
  if (topActive && isNodeLane) return { y1: rowTop, y2: center }
  if (bottomActive && isNodeLane) return { y1: center, y2: rowBottom }
  return undefined
}

const laneIndex = (lanes: GitGraphLaneView[], laneId: string) => {
  const index = lanes.findIndex((lane) => lane.id === laneId)
  return index === -1 ? 0 : index
}

const laneColor = (lane: GitGraphLaneView, index: number) => {
  if (lane.color) return lane.color
  const colors = [
    '#dc2626',
    '#2563eb',
    '#16a34a',
    '#ca8a04',
    '#7c3aed',
    '#0891b2',
    '#db2777',
    '#ea580c'
  ]
  return colors[index % colors.length]
}

const rowNodeColor = (row: GitGraphRowView): string | undefined => {
  const lanes = normalizedLanes(row)
  const nodeLaneId = row.graph.nodeLaneId ?? lanes.find((lane) => lane.active)?.id ?? lanes[0]?.id
  if (!nodeLaneId) return undefined
  const nodeIndex = laneIndex(lanes, nodeLaneId)
  const lane = lanes[nodeIndex]
  return lane ? laneColor(lane, nodeIndex) : undefined
}

const nodeSvgStyle = (lane: GitGraphLaneView, index: number): CSSProperties => ({
  fill: laneColor(lane, index),
  stroke: themeTokens.color.surface,
  strokeWidth: 3
})

const laneSvgStyle = (lane: GitGraphLaneView, index: number): CSSProperties => ({
  stroke: lane.active ? laneColor(lane, index) : themeTokens.color.borderSubtle,
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  opacity: lane.active ? 1 : 0.55
})

const edgeSvgStyle = (lane: GitGraphLaneView | undefined, index: number): CSSProperties => ({
  fill: 'none',
  stroke: lane ? laneColor(lane, index) : themeTokens.color.borderSubtle,
  strokeWidth: 2.4,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  opacity: 1
})

type EdgePosition = 'top' | 'center' | 'bottom'

const edgeY = (rowIndex: number, position: EdgePosition) => {
  if (position === 'top') return rowIndex * rowHeight
  if (position === 'bottom') return (rowIndex + 1) * rowHeight
  return rowCenterY(rowIndex)
}

const edgePath = (rowIndex: number, fromX: number, toX: number, fromPosition: EdgePosition, toPosition: EdgePosition) => (
  `M ${fromX} ${edgeY(rowIndex, fromPosition)} L ${toX} ${edgeY(rowIndex, toPosition)}`
)

const handleContextMenu = (
  event: MouseEvent<HTMLTableRowElement>,
  commitHash: string,
  onSelectCommit: (commitHash: string) => void,
  onOpenContextMenu: (request: GitCommitMenuRequest) => void
) => {
  event.preventDefault()
  onSelectCommit(commitHash)
  onOpenContextMenu({ commitHash, x: event.clientX, y: event.clientY, triggerElement: event.currentTarget })
}

const handleRowKeyDown = (
  event: KeyboardEvent<HTMLTableRowElement>,
  rowIndex: number,
  rows: GitGraphRowView[],
  onSelectCommit: (commitHash: string) => void,
  onOpenDetail: (commitHash: string) => void,
  onOpenContextMenu: (request: GitCommitMenuRequest) => void
) => {
  const commitHash = rows[rowIndex]?.commitHash
  if (!commitHash) return

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const nextIndex = event.key === 'ArrowDown'
      ? Math.min(rows.length - 1, rowIndex + 1)
      : Math.max(0, rowIndex - 1)
    if (nextIndex === rowIndex) return

    const nextHash = rows[nextIndex]?.commitHash
    if (!nextHash) return

    onSelectCommit(nextHash)
    focusRowByIndex(event.currentTarget, nextIndex)
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    onOpenDetail(commitHash)
    return
  }

  if (event.key === ' ') {
    event.preventDefault()
    onSelectCommit(commitHash)
    return
  }

  if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
    event.preventDefault()
    onSelectCommit(commitHash)
    const rect = event.currentTarget.getBoundingClientRect()
    onOpenContextMenu({
      commitHash,
      x: rect.left + Math.min(24, Math.max(8, rect.width / 2)),
      y: rect.top + Math.max(8, rect.height / 2),
      triggerElement: event.currentTarget
    })
  }
}

const focusRowByIndex = (currentRow: HTMLTableRowElement, rowIndex: number) => {
  const row = currentRow.parentElement?.querySelectorAll<HTMLTableRowElement>('[data-git-commit-hash]').item(rowIndex)
  row?.focus()
}

const formatDate = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

const tableFrameStyle: CSSProperties = {
  position: 'relative',
  minWidth: 0,
  width: '100%'
}

const graphOverlayStyle = (graphWidth: number): CSSProperties => ({
  position: 'absolute',
  top: headerHeight,
  left: 0,
  width: graphWidth,
  pointerEvents: 'none',
  overflow: 'visible',
  zIndex: 1
})

const tableStyle: CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  fontSize: themeTokens.typography.body
}

const tableHeadStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 3,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.textMuted
}

const headerCellStyle: CSSProperties = {
  position: 'relative',
  height: headerHeight,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left',
  userSelect: 'none'
}

const graphHeaderCellStyle = (graphWidth: number): CSSProperties => ({ width: graphWidth })

const resizeHandleStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: -4,
  width: 8,
  height: '100%',
  border: 0,
  padding: 0,
  background: 'transparent',
  cursor: 'col-resize',
  zIndex: 4
}

const rowStyle: CSSProperties = {
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  cursor: 'default'
}

const selectedRowStyle: CSSProperties = {
  ...rowStyle,
  background: themeTokens.color.hover
}

const cellStyle: CSSProperties = {
  height: rowHeight,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const graphCellStyle: CSSProperties = {
  padding: 0,
  overflow: 'visible',
  borderBottom: 0
}
const descriptionCellStyle: CSSProperties = { minWidth: 0 }
const descriptionContentStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: themeTokens.spacing.xs, minWidth: 0, maxWidth: '100%' }
const subjectStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const dateCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }
const authorCellStyle: CSSProperties = { color: themeTokens.color.text }
const commitCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }
