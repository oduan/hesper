import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { themeTokens } from '../theme'
import { GitCommitContextMenu } from './GitCommitContextMenu'
import { GitCommitDetailDrawer } from './GitCommitDetailDrawer'
import { GitGraphTable, type GitCommitMenuRequest } from './GitGraphTable'
import type { GitCommitDetailView, GitGraphRowView } from './git-graph-types'

export type GitGraphFullscreenProps = {
  open: boolean
  rows: GitGraphRowView[]
  selectedCommit?: string
  detail?: GitCommitDetailView
  loading?: boolean
  error?: string
  onClose: () => void
  onSelectCommit: (commitHash: string) => void
  onLoadCommitDetail: (commitHash: string) => void
  onCreateBranch: (commitHash: string) => void
  onCreateTag: (commitHash: string) => void
  onCheckout: (ref: string) => void
  onCopyCommitId?: (commitHash: string) => void
}

export function GitGraphFullscreen({
  open,
  rows,
  selectedCommit,
  detail,
  loading,
  error,
  onClose,
  onSelectCommit,
  onLoadCommitDetail,
  onCreateBranch,
  onCreateTag,
  onCheckout,
  onCopyCommitId
}: GitGraphFullscreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [menuRequest, setMenuRequest] = useState<GitCommitMenuRequest | undefined>()
  const [detailCommitHash, setDetailCommitHash] = useState<string | undefined>()

  const detailOpen = Boolean(detailCommitHash)
  const selectedRow = useMemo(
    () => rows.find((row) => row.commitHash === (detailCommitHash ?? selectedCommit)) ?? rows[0],
    [detailCommitHash, rows, selectedCommit]
  )

  const focusCommitRow = (commitHash?: string, fallbackToFirstRow = true) => {
    const root = rootRef.current
    if (!root) return
    const rowsByHash = Array.from(root.querySelectorAll<HTMLElement>('[data-git-commit-hash]'))
    const selectedRow = rowsByHash.find((candidate) => candidate.getAttribute('data-git-commit-hash') === commitHash)
    const row = selectedRow ?? (fallbackToFirstRow ? rowsByHash[0] : undefined)
    ;(row ?? root).focus()
  }

  const closeMenu = (restoreFocus = true) => {
    const triggerElement = menuRequest?.triggerElement
    setMenuRequest(undefined)
    if (restoreFocus) {
      window.setTimeout(() => (triggerElement?.isConnected ? triggerElement.focus() : focusCommitRow(selectedCommit)), 0)
    }
  }

  const closeDetail = () => {
    const commitToRestore = detailCommitHash ?? selectedCommit
    setDetailCommitHash(undefined)
    window.setTimeout(() => focusCommitRow(commitToRestore), 0)
  }
  const openDetail = (commitHash: string) => {
    setDetailCommitHash(commitHash)
    onLoadCommitDetail(commitHash)
  }

  useEffect(() => {
    if (!open) {
      setMenuRequest(undefined)
      setDetailCommitHash(undefined)
      return
    }

    window.setTimeout(() => {
      const root = rootRef.current
      if (!root) return
      if (document.activeElement && root.contains(document.activeElement)) return
      focusCommitRow(selectedCommit, false)
    }, 0)
  }, [open, selectedCommit])

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return

      event.preventDefault()
      event.stopPropagation()

      if (menuRequest) {
        closeMenu()
        return
      }

      if (detailOpen) {
        closeDetail()
        return
      }

      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [detailOpen, menuRequest, onClose, open])

  if (!open) return null

  return (
    <div ref={rootRef} role="dialog" aria-modal="true" aria-label="Git 提交图谱" tabIndex={-1} style={fullscreenStyle}>
      <header style={headerStyle}>
        <div>
          <p style={eyebrowStyle}>Repository history</p>
          <h1 style={titleStyle}>Git 提交图谱</h1>
        </div>
        <button type="button" aria-label="关闭 Git 提交图谱" style={closeButtonStyle} onClick={onClose}>
          <svg aria-hidden="true" viewBox="0 0 24 24" style={iconStyle}>
            <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {error && !detailOpen ? <div role="alert" style={bannerStyle}>{error}</div> : null}
      {loading && !detailOpen ? <div style={bannerStyle}>正在加载 Git 图谱…</div> : null}

      <main aria-label="Git 图谱内容" className="hesper-theme-scrollbar" style={contentStyle}>
        <GitGraphTable
          rows={rows}
          selectedCommit={selectedCommit}
          onSelectCommit={onSelectCommit}
          onOpenContextMenu={setMenuRequest}
          onOpenDetail={openDetail}
        />
      </main>

      {menuRequest ? (
        <GitCommitContextMenu
          commitHash={menuRequest.commitHash}
          x={menuRequest.x}
          y={menuRequest.y}
          onClose={closeMenu}
          onCreateBranch={onCreateBranch}
          onCreateTag={onCreateTag}
          onCheckout={onCheckout}
          onCopyCommitId={onCopyCommitId}
          onViewDetail={openDetail}
        />
      ) : null}

      <GitCommitDetailDrawer
        open={detailOpen}
        commitHash={detailCommitHash}
        detail={detail?.commitHash === detailCommitHash ? detail : undefined}
        row={selectedRow}
        loading={loading}
        error={error}
        onClose={closeDetail}
        onCreateBranch={onCreateBranch}
        onCreateTag={onCreateTag}
        onCheckout={onCheckout}
        onCopyCommitId={onCopyCommitId}
      />
    </div>
  )
}

const fullscreenStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  right: 0,
  bottom: 0,
  left: 0,
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  minWidth: 0,
  minHeight: 0,
  background: themeTokens.color.surface,
  color: themeTokens.color.text
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: themeTokens.spacing.md,
  padding: `${themeTokens.spacing.md} ${themeTokens.spacing.lg}`,
  borderBottom: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surfaceMuted
}

const eyebrowStyle: CSSProperties = {
  margin: 0,
  color: themeTokens.color.textMuted,
  fontSize: 12,
  letterSpacing: 0.6,
  textTransform: 'uppercase'
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: themeTokens.color.text,
  fontSize: 18,
  lineHeight: 1.25
}

const closeButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  borderRadius: themeTokens.radius.md,
  background: 'transparent',
  color: themeTokens.color.text,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center'
}

const iconStyle: CSSProperties = { width: 18, height: 18 }

const bannerStyle: CSSProperties = {
  padding: `${themeTokens.spacing.sm} ${themeTokens.spacing.lg}`,
  borderBottom: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.textMuted
}

const contentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'auto',
  background: themeTokens.color.surface
}
