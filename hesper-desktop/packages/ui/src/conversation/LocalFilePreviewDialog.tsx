import { useEffect, useId, useMemo, type CSSProperties } from 'react'
import type { LocalFilePreview } from '@hesper/shared'
import { darkTheme } from '../theme'
import { isTopFullscreenDialog, pushFullscreenDialog, removeFullscreenDialog } from './fullscreen-dialog-stack'
import { createSandboxedHtmlDocument } from './html-document'
import { MarkdownOutput } from './MarkdownOutput'

export type LocalFilePreviewDialogProps = {
  path: string
  loading?: boolean
  preview?: LocalFilePreview
  error?: string
  onClose: () => void
  onLocalFileClick?: ((path: string) => void) | undefined
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '未知大小'
  if (bytes < 1024) return `${bytes} 字节`
  const kib = bytes / 1024
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`
  const mib = kib / 1024
  return `${mib.toFixed(mib >= 10 ? 0 : 1)} MiB`
}

function fallbackName(path: string): string {
  return path.split('/').filter(Boolean).at(-1) ?? path
}

function MissingInlineContent({ kind }: { kind: string }) {
  return <p style={emptyStyle}>无法显示 {kind} 预览内容。</p>
}

function UnsupportedPreview({ preview }: { preview: LocalFilePreview }) {
  return (
    <section aria-label="不支持的本地文件" style={unsupportedCardStyle}>
      <h3 style={unsupportedTitleStyle}>不支持内联预览</h3>
      <dl style={metadataGridStyle}>
        <dt style={metadataTermStyle}>文件名</dt>
        <dd style={metadataValueStyle}>{preview.name}</dd>
        <dt style={metadataTermStyle}>路径</dt>
        <dd style={metadataValueStyle}>{preview.path}</dd>
        <dt style={metadataTermStyle}>MIME</dt>
        <dd style={metadataValueStyle}>{preview.mimeType || '未知'}</dd>
        <dt style={metadataTermStyle}>大小</dt>
        <dd style={metadataValueStyle}>{formatBytes(preview.bytes)}</dd>
      </dl>
    </section>
  )
}

function renderPreviewContent(preview: LocalFilePreview, htmlDocument: string | undefined, onLocalFileClick?: ((path: string) => void) | undefined) {
  switch (preview.kind) {
    case 'image':
      return preview.dataUrl ? (
        <div style={mediaCenterStyle}>
          <img alt={preview.name} src={preview.dataUrl} style={imageStyle} />
        </div>
      ) : <MissingInlineContent kind="图片" />
    case 'video':
      return preview.dataUrl ? (
        <video controls src={preview.dataUrl} style={videoStyle} />
      ) : <MissingInlineContent kind="视频" />
    case 'pdf':
      return preview.dataUrl ? (
        <iframe title={preview.name} sandbox="" src={preview.dataUrl} style={pdfFrameStyle} />
      ) : <MissingInlineContent kind="PDF" />
    case 'html':
      return (
        <iframe
          title="HTML 本地文件预览"
          sandbox=""
          srcDoc={htmlDocument}
          style={htmlFrameStyle}
        />
      )
    case 'markdown':
      return <MarkdownOutput content={preview.content ?? ''} onLocalFileClick={onLocalFileClick} />
    case 'json':
    case 'text':
      return <pre style={preStyle}>{preview.content ?? ''}</pre>
    case 'unsupported':
      return <UnsupportedPreview preview={preview} />
  }
}

export function LocalFilePreviewDialog({ path, loading = false, preview, error, onClose, onLocalFileClick }: LocalFilePreviewDialogProps) {
  const dialogId = useId()
  const htmlDocument = useMemo(
    () => (preview?.kind === 'html' ? createSandboxedHtmlDocument(preview.content ?? '') : undefined),
    [preview?.content, preview?.kind]
  )
  const title = preview?.name ?? fallbackName(path) ?? '本地文件预览'

  useEffect(() => {
    pushFullscreenDialog(dialogId)
    return () => removeFullscreenDialog(dialogId)
  }, [dialogId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTopFullscreenDialog(dialogId)) return

      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      onClose()
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [dialogId, onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="本地文件全屏预览"
      data-hesper-fullscreen-output="true"
      style={overlayStyle}
    >
      <div aria-label="本地文件预览内容" style={contentShellStyle}>
        <div aria-label="本地文件预览操作" style={actionsStyle}>
          <button type="button" aria-label="关闭本地文件预览" onClick={onClose} style={iconButtonStyle}>
            <svg aria-hidden="true" viewBox="0 0 24 24" style={iconStyle}>
              <path d="M7 7l10 10M17 7 7 17" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          aria-label="本地文件预览滚动区"
          className="hesper-theme-scrollbar"
          data-hesper-fullscreen-output-scroll="true"
          style={scrollAreaStyle}
        >
          <article aria-label="本地文件预览正文" style={contentBodyStyle}>
            <header style={headerStyle}>
              <h2 style={titleStyle}>{loading ? '加载本地文件…' : title}</h2>
              <div style={pathStyle}>{path}</div>
            </header>
            {loading ? (
              <p aria-live="polite" style={loadingStyle}>加载中…</p>
            ) : error ? (
              <div role="alert" style={errorStyle}>{error}</div>
            ) : preview ? (
              <>
                {preview.warning ? <div role="note" style={warningStyle}>{preview.warning}</div> : null}
                {renderPreviewContent(preview, htmlDocument, onLocalFileClick)}
              </>
            ) : null}
          </article>
        </div>
      </div>
    </div>
  )
}

const overlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  right: 0,
  bottom: 0,
  left: 0,
  background: darkTheme.color.surface,
  display: 'block',
  padding: 0,
  boxSizing: 'border-box',
  zIndex: 1000
}

const contentShellStyle: CSSProperties = {
  position: 'relative',
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  background: 'transparent',
  borderStyle: 'none'
}

const actionsStyle: CSSProperties = {
  position: 'absolute',
  top: darkTheme.spacing.lg,
  right: darkTheme.spacing.lg,
  zIndex: 2,
  display: 'flex'
}

const iconButtonStyle: CSSProperties = {
  width: 34,
  height: 34,
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.md,
  background: 'transparent',
  color: darkTheme.color.text,
  display: 'inline-grid',
  placeItems: 'center',
  cursor: 'pointer'
}

const iconStyle: CSSProperties = {
  width: 18,
  height: 18,
  display: 'block'
}

const scrollAreaStyle: CSSProperties = {
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
  overscrollBehavior: 'contain',
  overflowAnchor: 'none',
  willChange: 'scroll-position',
  boxSizing: 'border-box',
  padding: `${darkTheme.spacing.xl} ${darkTheme.spacing.lg}`
}

const contentBodyStyle: CSSProperties = {
  maxWidth: 1120,
  minHeight: '100%',
  margin: '0 auto',
  background: 'transparent',
  borderStyle: 'none',
  color: darkTheme.color.text,
  display: 'grid',
  alignContent: 'start',
  gap: darkTheme.spacing.lg
}

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: darkTheme.spacing.xs,
  paddingRight: 52
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 18,
  lineHeight: 1.3,
  fontWeight: 800,
  color: darkTheme.color.text,
  overflowWrap: 'anywhere'
}

const pathStyle: CSSProperties = {
  color: darkTheme.color.textMuted,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: darkTheme.typography.body,
  lineHeight: 1.45,
  overflowWrap: 'anywhere'
}

const loadingStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted
}

const errorStyle: CSSProperties = {
  padding: darkTheme.spacing.md,
  borderRadius: darkTheme.radius.lg,
  border: `1px solid ${darkTheme.color.danger}`,
  color: darkTheme.color.danger,
  background: 'rgba(247, 118, 142, 0.10)',
  overflowWrap: 'anywhere'
}

const warningStyle: CSSProperties = {
  padding: darkTheme.spacing.md,
  borderRadius: darkTheme.radius.lg,
  border: `1px solid ${darkTheme.color.warning}`,
  color: darkTheme.color.warning,
  background: 'rgba(224, 175, 104, 0.10)',
  overflowWrap: 'anywhere'
}

const mediaCenterStyle: CSSProperties = {
  minHeight: 0,
  display: 'grid',
  placeItems: 'center'
}

const imageStyle: CSSProperties = {
  display: 'block',
  maxWidth: '100%',
  maxHeight: 'calc(100vh - 180px)',
  objectFit: 'contain',
  borderRadius: darkTheme.radius.lg
}

const videoStyle: CSSProperties = {
  width: '100%',
  maxHeight: 'calc(100vh - 180px)',
  borderRadius: darkTheme.radius.lg,
  background: '#000'
}

const pdfFrameStyle: CSSProperties = {
  width: '100%',
  minHeight: 'calc(100vh - 170px)',
  border: 0,
  borderRadius: darkTheme.radius.lg,
  background: '#fff'
}

const htmlFrameStyle: CSSProperties = {
  width: '100%',
  minHeight: 'calc(100vh - 170px)',
  border: 0,
  borderRadius: darkTheme.radius.lg,
  background: '#fff'
}

const preStyle: CSSProperties = {
  margin: 0,
  padding: darkTheme.spacing.lg,
  overflow: 'auto',
  borderRadius: darkTheme.radius.lg,
  background: darkTheme.color.surfaceMuted,
  color: darkTheme.color.text,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  fontSize: darkTheme.typography.body,
  lineHeight: 1.55,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
}

const emptyStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted
}

const unsupportedCardStyle: CSSProperties = {
  display: 'grid',
  gap: darkTheme.spacing.md,
  padding: darkTheme.spacing.lg,
  borderRadius: darkTheme.radius.lg,
  border: `1px solid ${darkTheme.color.border}`,
  background: darkTheme.color.surfaceMuted
}

const unsupportedTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: darkTheme.typography.body,
  lineHeight: 1.25,
  fontWeight: 800,
  color: darkTheme.color.text
}

const metadataGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'max-content minmax(0, 1fr)',
  gap: `${darkTheme.spacing.sm} ${darkTheme.spacing.md}`,
  margin: 0
}

const metadataTermStyle: CSSProperties = {
  color: darkTheme.color.textMuted,
  margin: 0
}

const metadataValueStyle: CSSProperties = {
  color: darkTheme.color.text,
  margin: 0,
  overflowWrap: 'anywhere'
}
