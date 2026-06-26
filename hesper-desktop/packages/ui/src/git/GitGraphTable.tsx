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

const laneGap = 18
const laneInset = 14
const graphRowHeight = 42
const graphLineOverlap = 2
const graphSvgHeight = graphRowHeight + graphLineOverlap * 2
const graphNodeY = graphLineOverlap + graphRowHeight / 2

export function GitGraphTable({ rows, selectedCommit, onSelectCommit, onOpenContextMenu, onOpenDetail }: GitGraphTableProps) {
  return (
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
              <td style={{ ...cellStyle, ...graphCellStyle }}>
                <CommitGraph row={row} />
              </td>
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
  )
}

function CommitGraph({ row }: { row: GitGraphRowView }) {
  const lanes = row.graph.lanes.length > 0 ? row.graph.lanes : [{ id: 'default', active: true }]
  const nodeLaneId = row.graph.nodeLaneId ?? lanes.find((lane) => lane.active)?.id ?? lanes[0]?.id
  const laneCount = Math.max(lanes.length, 1)
  const graphWidth = laneInset * 2 + (laneCount - 1) * laneGap

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${graphWidth} ${graphSvgHeight}`}
      preserveAspectRatio="none"
      style={{ ...graphCanvasStyle, width: graphWidth }}
    >
      {lanes.map((lane, index) => {
        const x = laneInset + index * laneGap
        return (
          <line
            key={lane.id}
            data-testid={`git-graph-lane-${lane.id}`}
            x1={x}
            x2={x}
            y1={0}
            y2={graphSvgHeight}
            style={laneSvgStyle(lane, index)}
          />
        )
      })}
      {row.graph.edges?.map((edge, index) => {
        const fromIndex = laneIndex(lanes, edge.fromLaneId)
        const toIndex = laneIndex(lanes, edge.toLaneId)
        if (fromIndex === toIndex) return null
        const x1 = laneInset + fromIndex * laneGap
        const x2 = laneInset + toIndex * laneGap
        return (
          <path
            key={`${edge.fromLaneId}-${edge.toLaneId}-${index}`}
            data-testid={`git-graph-edge-${edge.fromLaneId}-${edge.toLaneId}`}
            d={edgePath(x1, x2)}
            style={edgeSvgStyle(lanes[fromIndex] ?? lanes[toIndex], fromIndex)}
          />
        )
      })}
      {nodeLaneId ? (
        <circle
          data-testid={`git-graph-node-${row.commitHash}`}
          cx={laneInset + laneIndex(lanes, nodeLaneId) * laneGap}
          cy={graphNodeY}
          r={5.5}
          style={nodeSvgStyle(lanes, nodeLaneId)}
        />
      ) : null}
    </svg>
  )
}

const laneIndex = (lanes: GitGraphLaneView[], laneId: string) => Math.max(0, lanes.findIndex((lane) => lane.id === laneId))

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

const nodeSvgStyle = (lanes: GitGraphLaneView[], nodeLaneId: string): CSSProperties => {
  const index = laneIndex(lanes, nodeLaneId)
  const lane = lanes[index] ?? { id: nodeLaneId, active: true }
  return {
    fill: laneColor(lane, index),
    stroke: themeTokens.color.surface,
    strokeWidth: 3,
    filter: `drop-shadow(0 0 0 ${laneColor(lane, index)})`
  }
}

const laneSvgStyle = (lane: GitGraphLaneView, index: number): CSSProperties => ({
  stroke: lane.active ? laneColor(lane, index) : themeTokens.color.borderSubtle,
  strokeWidth: 2,
  strokeLinecap: 'round',
  opacity: lane.active ? 1 : 0.55
})

const edgeSvgStyle = (lane: GitGraphLaneView | undefined, index: number): CSSProperties => ({
  fill: 'none',
  stroke: lane ? laneColor(lane, index) : themeTokens.color.borderSubtle,
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  opacity: 0.9
})

const edgePath = (fromX: number, toX: number) => {
  const controlY = graphNodeY + (graphSvgHeight - graphNodeY) * 0.58
  return `M ${fromX} ${graphNodeY} C ${fromX} ${controlY}, ${toX} ${controlY}, ${toX} ${graphSvgHeight}`
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

const tableStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  borderCollapse: 'collapse',
  tableLayout: 'fixed',
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  fontSize: themeTokens.typography.body
}

const tableHeadStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 1,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.textMuted
}

const headerCellStyle: CSSProperties = {
  height: 36,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left'
}

const graphHeaderCellStyle: CSSProperties = { width: 104 }
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
  height: 42,
  padding: `0 ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  verticalAlign: 'middle',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const graphCellStyle: CSSProperties = { padding: 0, overflow: 'visible', borderBottom: 0 }
const graphCanvasStyle: CSSProperties = { display: 'block', height: graphSvgHeight, margin: `${-graphLineOverlap}px auto`, overflow: 'visible' }
const descriptionCellStyle: CSSProperties = { minWidth: 0 }
const descriptionContentStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: themeTokens.spacing.xs, minWidth: 0, maxWidth: '100%' }
const subjectStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const dateCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }
const authorCellStyle: CSSProperties = { color: themeTokens.color.text }
const commitCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }
