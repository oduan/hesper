import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
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

const graphColumnWidth = 104
const laneGap = 18
const laneInset = 18
const rowHeight = 42
const headerHeight = 36
const lineOverlap = 2
const nodeRadius = 6

export function GitGraphTable({ rows, selectedCommit, onSelectCommit, onOpenContextMenu, onOpenDetail }: GitGraphTableProps) {
  return (
    <div style={tableFrameStyle}>
      <GraphOverlay rows={rows} />
      <table role="table" aria-label="Git 提交图谱表格" style={tableStyle}>
        <thead style={tableHeadStyle}>
          <tr>
            <th scope="col" style={{ ...headerCellStyle, ...graphHeaderCellStyle }}>图谱</th>
            <th scope="col" style={headerCellStyle}>描述</th>
            <th scope="col" style={dateHeaderCellStyle}>日期</th>
            <th scope="col" style={authorHeaderCellStyle}>作者</th>
            <th scope="col" style={commitHeaderCellStyle}>提交</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const selected = selectedCommit === row.commitHash
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
                    {row.refs.map((ref) => <GitRefBadge key={`${ref.type}-${ref.name}`} refView={ref} />)}
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

function GraphOverlay({ rows }: { rows: GitGraphRowView[] }) {
  if (rows.length === 0) return null

  const svgHeight = rows.length * rowHeight

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${graphColumnWidth} ${svgHeight}`}
      preserveAspectRatio="none"
      style={{ ...graphOverlayStyle, height: svgHeight }}
    >
      {rows.flatMap((row, rowIndex) => normalizedLanes(row).map((lane, lanePosition) => {
        const x = laneInset + lanePosition * laneGap
        return (
          <line
            key={`lane-${row.commitHash}-${lane.id}`}
            data-testid={`git-graph-lane-${row.commitHash}-${lane.id}`}
            x1={x}
            x2={x}
            y1={Math.max(0, rowIndex * rowHeight - lineOverlap)}
            y2={Math.min(svgHeight, (rowIndex + 1) * rowHeight + lineOverlap)}
            style={laneSvgStyle(lane, lanePosition)}
            vectorEffect="non-scaling-stroke"
          />
        )
      }))}
      {rows.flatMap((row, rowIndex) => (row.graph.edges ?? []).flatMap((edge, edgeIndex) => {
        const lanes = normalizedLanes(row)
        const fromIndex = laneIndex(lanes, edge.fromLaneId)
        const toIndex = laneIndex(lanes, edge.toLaneId)
        if (fromIndex === toIndex) return []

        const fromX = laneInset + fromIndex * laneGap
        const toX = laneInset + toIndex * laneGap
        const path = edgePath(rowIndex, fromX, toX, rows.length)
        if (!path) return []
        return [
          <path
            key={`edge-${row.commitHash}-${edge.fromLaneId}-${edge.toLaneId}-${edgeIndex}`}
            data-testid={`git-graph-edge-${row.commitHash}-${edge.fromLaneId}-${edge.toLaneId}`}
            d={path}
            style={edgeSvgStyle(lanes[toIndex] ?? lanes[fromIndex], toIndex)}
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

const rowCenterY = (rowIndex: number) => rowIndex * rowHeight + rowHeight / 2

const laneIndex = (lanes: GitGraphLaneView[], laneId: string) => {
  const index = lanes.findIndex((lane) => lane.id === laneId)
  return index === -1 ? 0 : index
}

const laneColor = (lane: GitGraphLaneView, index: number) => {
  if (lane.color) return lane.color
  const colors = [
    themeTokens.color.accent,
    themeTokens.color.success,
    themeTokens.color.warning,
    themeTokens.color.danger,
    themeTokens.color.textMuted
  ]
  return colors[index % colors.length]
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

const edgePath = (rowIndex: number, fromX: number, toX: number, rowCount: number) => {
  if (rowIndex >= rowCount - 1) return undefined
  const startY = rowCenterY(rowIndex)
  const endY = rowCenterY(rowIndex + 1)
  const distance = endY - startY
  const controlY1 = startY + distance * 0.56
  const controlY2 = endY - distance * 0.56
  return `M ${fromX} ${startY} C ${fromX} ${controlY1}, ${toX} ${controlY2}, ${toX} ${endY}`
}

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

const graphOverlayStyle: CSSProperties = {
  position: 'absolute',
  top: headerHeight,
  left: 0,
  width: graphColumnWidth,
  pointerEvents: 'none',
  overflow: 'visible',
  zIndex: 1
}

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
  height: headerHeight,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left'
}

const graphHeaderCellStyle: CSSProperties = { width: graphColumnWidth }
const dateHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 132 }
const authorHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 160 }
const commitHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 108 }

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
