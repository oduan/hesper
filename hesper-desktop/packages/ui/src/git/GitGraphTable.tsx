import type { CSSProperties, KeyboardEvent, MouseEvent } from 'react'
import { themeTokens } from '../theme'
import { RefBadge } from './GitCommitDetailDrawer'
import type { GitGraphLaneView, GitGraphRowView } from './git-graph-types'

export type GitCommitMenuRequest = {
  commitHash: string
  x: number
  y: number
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
        {rows.map((row) => {
          const selected = selectedCommit === row.commitHash
          return (
            <tr
              key={row.commitHash}
              tabIndex={0}
              aria-selected={selected}
              aria-label={`${row.subject} ${row.shortHash}`}
              style={selected ? selectedRowStyle : rowStyle}
              onClick={() => onSelectCommit(row.commitHash)}
              onContextMenu={(event) => handleContextMenu(event, row.commitHash, onSelectCommit, onOpenContextMenu)}
              onKeyDown={(event) => handleRowKeyDown(event, row.commitHash, onOpenDetail)}
            >
              <td style={{ ...cellStyle, ...graphCellStyle }}>
                <CommitGraph row={row} />
              </td>
              <td style={{ ...cellStyle, ...descriptionCellStyle }}>
                <span aria-label="提交描述" style={descriptionContentStyle}>
                  {row.refs.map((ref) => <RefBadge key={`${ref.type}-${ref.name}`} refView={ref} />)}
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
    <div aria-hidden="true" style={{ ...graphCanvasStyle, width: graphWidth }}>
      {row.graph.edges?.map((edge, index) => {
        const fromIndex = laneIndex(lanes, edge.fromLaneId)
        const toIndex = laneIndex(lanes, edge.toLaneId)
        const x1 = laneInset + fromIndex * laneGap
        const x2 = laneInset + toIndex * laneGap
        return <span key={`${edge.fromLaneId}-${edge.toLaneId}-${index}`} style={edgeStyle(x1, x2)} />
      })}
      {lanes.map((lane, index) => {
        const laneX = `${laneInset + index * laneGap}px`
        return (
          <span
            key={lane.id}
            data-testid={`git-graph-lane-${lane.id}`}
            style={laneStyle(lane, index, laneX)}
          />
        )
      })}
      {nodeLaneId ? (
        <span
          data-testid={`git-graph-node-${row.commitHash}`}
          style={nodeStyle(lanes, nodeLaneId)}
        />
      ) : null}
    </div>
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

const nodeStyle = (lanes: GitGraphLaneView[], nodeLaneId: string): CSSProperties & Record<'--git-graph-lane-x', string> => {
  const index = laneIndex(lanes, nodeLaneId)
  const lane = lanes[index] ?? { id: nodeLaneId, active: true }
  const x = `${laneInset + index * laneGap}px`
  return {
    '--git-graph-lane-x': x,
    position: 'absolute',
    left: 'var(--git-graph-lane-x)',
    top: '50%',
    width: 11,
    height: 11,
    borderRadius: 999,
    border: `2px solid ${themeTokens.color.surface}`,
    background: laneColor(lane, index),
    boxShadow: `0 0 0 1px ${laneColor(lane, index)}`,
    transform: 'translate(-50%, -50%)',
    zIndex: 2
  }
}

const laneStyle = (lane: GitGraphLaneView, index: number, laneX: string): CSSProperties & Record<'--git-graph-lane-x', string> => ({
  '--git-graph-lane-x': laneX,
  position: 'absolute',
  left: 'var(--git-graph-lane-x)',
  top: 0,
  bottom: 0,
  width: 2,
  borderRadius: 999,
  background: lane.active ? laneColor(lane, index) : themeTokens.color.borderSubtle,
  opacity: lane.active ? 1 : 0.55,
  transform: 'translateX(-50%)'
})

const edgeStyle = (fromX: number, toX: number): CSSProperties => ({
  position: 'absolute',
  left: Math.min(fromX, toX),
  top: '50%',
  width: Math.max(2, Math.abs(toX - fromX)),
  height: 2,
  borderRadius: 999,
  background: themeTokens.color.border,
  transform: fromX <= toX ? 'rotate(28deg)' : 'rotate(-28deg)',
  transformOrigin: fromX <= toX ? 'left center' : 'right center',
  opacity: 0.8
})

const handleContextMenu = (
  event: MouseEvent<HTMLTableRowElement>,
  commitHash: string,
  onSelectCommit: (commitHash: string) => void,
  onOpenContextMenu: (request: GitCommitMenuRequest) => void
) => {
  event.preventDefault()
  onSelectCommit(commitHash)
  onOpenContextMenu({ commitHash, x: event.clientX, y: event.clientY })
}

const handleRowKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, commitHash: string, onOpenDetail: (commitHash: string) => void) => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  onOpenDetail(commitHash)
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
  borderBottom: `1px solid ${themeTokens.color.border}`,
  fontSize: 12,
  fontWeight: 600,
  textAlign: 'left'
}

const graphHeaderCellStyle: CSSProperties = { width: 104 }
const dateHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 132 }
const authorHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 160 }
const commitHeaderCellStyle: CSSProperties = { ...headerCellStyle, width: 108 }

const rowStyle: CSSProperties = {
  background: 'transparent',
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

const graphCellStyle: CSSProperties = { padding: 0 }
const graphCanvasStyle: CSSProperties = { position: 'relative', height: 42, margin: '0 auto' }
const descriptionCellStyle: CSSProperties = { minWidth: 0 }
const descriptionContentStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: themeTokens.spacing.xs, minWidth: 0, maxWidth: '100%' }
const subjectStyle: CSSProperties = { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const dateCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }
const authorCellStyle: CSSProperties = { color: themeTokens.color.text }
const commitCellStyle: CSSProperties = { color: themeTokens.color.textMuted, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace' }
