import { useEffect, useRef, type CSSProperties } from 'react'
import { themeTokens } from '../theme'
import { GitRefBadge } from './GitRefBadge'
import type { GitCommitDetailView, GitGraphRowView } from './git-graph-types'

export type GitCommitDetailDrawerProps = {
  open: boolean
  commitHash?: string | undefined
  detail?: GitCommitDetailView | undefined
  row?: GitGraphRowView | undefined
  loading?: boolean | undefined
  error?: string | undefined
  onClose: () => void
  onCreateBranch: (commitHash: string) => void
  onCreateTag: (commitHash: string) => void
  onCheckout: (ref: string) => void
  onCopyCommitId?: ((commitHash: string) => void) | undefined
}

export function GitCommitDetailDrawer({
  open,
  commitHash,
  detail,
  row,
  loading,
  error,
  onClose,
  onCreateBranch,
  onCreateTag,
  onCheckout,
  onCopyCommitId
}: GitCommitDetailDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const effectiveHash = detail?.commitHash ?? commitHash ?? row?.commitHash ?? ''
  const matchingRow = row?.commitHash === effectiveHash ? row : undefined
  const shortHash = detail?.shortHash ?? matchingRow?.shortHash ?? effectiveHash.slice(0, 7)
  const subject = detail?.subject ?? matchingRow?.subject ?? '提交详情'
  const refs = detail?.refs ?? matchingRow?.refs ?? []
  const parents = detail?.parents ?? matchingRow?.parents ?? []

  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
  }, [open, effectiveHash])

  if (!open) return null

  const copyCommitId = () => {
    if (!effectiveHash) return
    if (onCopyCommitId) {
      onCopyCommitId(effectiveHash)
      return
    }
    void navigator.clipboard?.writeText(effectiveHash)
  }

  return (
    <aside role="dialog" aria-label="提交详情" aria-modal="false" style={drawerStyle}>
      <header style={drawerHeaderStyle}>
        <div style={titleGroupStyle}>
          <p style={eyebrowStyle}>Commit detail</p>
          <h2 style={titleStyle}>{subject}</h2>
        </div>
        <button ref={closeButtonRef} type="button" aria-label="关闭提交详情" onClick={onClose} style={iconButtonStyle}>
          <svg aria-hidden="true" viewBox="0 0 24 24" style={iconStyle}>
            <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div style={actionsStyle}>
        <button type="button" style={actionButtonStyle} onClick={() => onCreateBranch(effectiveHash)} disabled={!effectiveHash}>新建分支</button>
        <button type="button" style={actionButtonStyle} onClick={() => onCreateTag(effectiveHash)} disabled={!effectiveHash}>创建标签</button>
        <button type="button" style={actionButtonStyle} onClick={() => onCheckout(effectiveHash)} disabled={!effectiveHash}>检出</button>
        <button type="button" style={actionButtonStyle} onClick={copyCommitId} disabled={!effectiveHash}>复制 ID</button>
      </div>

      <div className="hesper-theme-scrollbar" style={contentStyle}>
        {loading ? <p style={mutedStyle}>正在加载提交详情…</p> : null}
        {error ? <p role="alert" style={errorStyle}>{error}</p> : null}

        <section style={sectionStyle} aria-label="提交摘要">
          <dl role="list" aria-label="提交元数据" style={infoListStyle}>
            <InfoRow label="Short hash" value={shortHash} />
            <InfoRow label="Full hash" value={effectiveHash} />
            <InfoRow label="Author" value={formatPerson(detail?.authorName ?? matchingRow?.authorName, detail?.authorEmail ?? matchingRow?.authorEmail)} />
            <InfoRow label="Author date" value={formatDate(detail?.authoredAt ?? matchingRow?.authoredAt)} />
            {detail ? <InfoRow label="Committer" value={formatPerson(detail.committerName, detail.committerEmail)} /> : null}
            {detail ? <InfoRow label="Commit date" value={formatDate(detail.committedAt)} /> : null}
            <InfoRow label="Parents" value={parents.length > 0 ? parents.join(', ') : '无'} />
          </dl>
        </section>

        {refs.length > 0 ? (
          <section style={sectionStyle} aria-label="提交引用">
            <h3 style={sectionTitleStyle}>Refs</h3>
            <div style={refListStyle}>{refs.map((ref) => <GitRefBadge key={`${ref.type}-${ref.name}`} refView={ref} />)}</div>
          </section>
        ) : null}

        {detail?.body ? (
          <section style={sectionStyle} aria-label="提交正文">
            <h3 style={sectionTitleStyle}>Body</h3>
            <p style={bodyStyle}>{detail.body}</p>
          </section>
        ) : null}

        {detail?.files?.length ? (
          <section style={sectionStyle} aria-label="文件变更">
            <h3 style={sectionTitleStyle}>File changes</h3>
            <ul style={fileListStyle}>
              {detail.files.map((file) => (
                <li key={`${file.status}-${file.path}`} style={fileItemStyle}>
                  <span style={fileStatusStyle}>{file.status}</span>
                  <span style={filePathStyle}>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
                  <span style={diffStatStyle}>
                    {typeof file.additions === 'number' ? `+${file.additions}` : ''}
                    {typeof file.deletions === 'number' ? ` -${file.deletions}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </aside>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoRowStyle}>
      <dt style={infoLabelStyle}>{label}</dt>
      <dd style={infoValueStyle}>{value}</dd>
    </div>
  )
}

const formatPerson = (name?: string, email?: string) => {
  if (!name && !email) return '未知'
  if (!email) return name ?? '未知'
  if (!name) return email
  return `${name} <${email}>`
}

const formatDate = (value?: string) => {
  if (!value) return '未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

const drawerStyle: CSSProperties = {
  position: 'absolute',
  top: 0,
  right: 0,
  bottom: 0,
  width: 'min(460px, 42vw)',
  minWidth: 360,
  zIndex: 1050,
  display: 'flex',
  flexDirection: 'column',
  borderLeftWidth: 1,
  borderLeftStyle: 'solid',
  borderColor: themeTokens.color.border,
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  boxShadow: `-18px 0 48px ${themeTokens.color.shadow}`
}

const drawerHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: themeTokens.spacing.md,
  padding: themeTokens.spacing.lg,
  borderBottom: `1px solid ${themeTokens.color.border}`
}

const titleGroupStyle: CSSProperties = { minWidth: 0 }
const eyebrowStyle: CSSProperties = { margin: 0, color: themeTokens.color.textMuted, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.7 }
const titleStyle: CSSProperties = { margin: `${themeTokens.spacing.xs} 0 0`, fontSize: 18, lineHeight: 1.35, color: themeTokens.color.text }

const iconButtonStyle: CSSProperties = {
  width: 32,
  height: 32,
  border: 0,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.text,
  cursor: 'pointer',
  display: 'grid',
  placeItems: 'center'
}

const iconStyle: CSSProperties = { width: 18, height: 18 }

const actionsStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: themeTokens.spacing.sm,
  padding: `${themeTokens.spacing.md} ${themeTokens.spacing.lg}`,
  borderBottom: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surfaceMuted
}

const actionButtonStyle: CSSProperties = {
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.sm,
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  cursor: 'pointer',
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  font: 'inherit'
}

const contentStyle: CSSProperties = {
  flex: 1,
  overflow: 'auto',
  padding: themeTokens.spacing.lg,
  display: 'grid',
  alignContent: 'start',
  gap: themeTokens.spacing.lg
}

const sectionStyle: CSSProperties = {
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surfaceMuted,
  padding: themeTokens.spacing.md
}

const sectionTitleStyle: CSSProperties = { margin: `0 0 ${themeTokens.spacing.sm}`, fontSize: 13, color: themeTokens.color.text }
const mutedStyle: CSSProperties = { margin: 0, color: themeTokens.color.textMuted }
const errorStyle: CSSProperties = { margin: 0, color: themeTokens.color.danger }
const bodyStyle: CSSProperties = { margin: 0, color: themeTokens.color.text, whiteSpace: 'pre-wrap', lineHeight: 1.55 }

const infoListStyle: CSSProperties = { margin: 0 }
const infoRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: themeTokens.spacing.sm, padding: `${themeTokens.spacing.xs} 0` }
const infoLabelStyle: CSSProperties = { color: themeTokens.color.textMuted, margin: 0 }
const infoValueStyle: CSSProperties = { color: themeTokens.color.text, margin: 0, overflowWrap: 'anywhere' }
const refListStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: themeTokens.spacing.xs }

const fileListStyle: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: themeTokens.spacing.xs }
const fileItemStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '36px minmax(0, 1fr) auto', gap: themeTokens.spacing.sm, alignItems: 'center', color: themeTokens.color.text }
const fileStatusStyle: CSSProperties = { color: themeTokens.color.accent, fontVariantNumeric: 'tabular-nums' }
const filePathStyle: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const diffStatStyle: CSSProperties = { color: themeTokens.color.textMuted, fontVariantNumeric: 'tabular-nums' }
