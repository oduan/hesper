import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ThemedSelect } from '../conversation/ThemedSelect'
import { themeTokens } from '../theme'

export type CategorySettingsValue = {
  defaultModelId: string
  workspacePath: string
  soul: string
}

export type CategorySettingsModelOption = {
  value: string
  label: string
}
export type CategorySettingsModelOptionGroup = {
  id: string
  label: string
  options: ReadonlyArray<CategorySettingsModelOption>
}

export type CategorySettingsDialogProps = {
  category: { id: string; name: string }
  modelOptions?: string[]
  modelOptionGroups?: CategorySettingsModelOptionGroup[]
  defaultModelId?: string
  workspacePath?: string
  soul?: string
  pending?: boolean
  error?: string
  onSave: (value: CategorySettingsValue) => void
  onClose: () => void
  onSelectWorkspace: () => string | undefined | Promise<string | undefined>
}

type DialogDraft = CategorySettingsValue

function buildDraft(props: Pick<CategorySettingsDialogProps, 'defaultModelId' | 'workspacePath' | 'soul'>): DialogDraft {
  return {
    defaultModelId: props.defaultModelId ?? '',
    workspacePath: props.workspacePath ?? '',
    soul: props.soul ?? ''
  }
}

export function CategorySettingsDialog(props: CategorySettingsDialogProps) {
  const { category, modelOptions = [], modelOptionGroups = [], pending = false, error, onSave, onClose, onSelectWorkspace } = props
  const [draft, setDraft] = useState<DialogDraft>(() => buildDraft(props))
  const dialogRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const overlayPointerDownStartedRef = useRef(false)

  useEffect(() => {
    setDraft(buildDraft(props))
  }, [category.id, props.defaultModelId, props.workspacePath, props.soul])

  useEffect(() => {
    initialFocusRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const handleSelectWorkspace = useCallback(async () => {
    const workspacePath = await onSelectWorkspace()
    if (workspacePath !== undefined) setDraft((current) => ({ ...current, workspacePath }))
  }, [onSelectWorkspace])

  const handleOverlayPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    overlayPointerDownStartedRef.current = event.target === event.currentTarget
  }, [])

  const handleOverlayPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const shouldClose = overlayPointerDownStartedRef.current && event.target === event.currentTarget
    overlayPointerDownStartedRef.current = false
    if (shouldClose) onClose()
  }, [onClose])

  const flatGroupedOptions = modelOptionGroups.flatMap((group) => group.options.map((option) => option.value))
  const effectiveModelOptions = modelOptions.length > 0 ? modelOptions : flatGroupedOptions
  const hasGroupedOptions = modelOptionGroups.length > 0

  return (
    <div role="presentation" data-testid="category-settings-overlay" onPointerDown={handleOverlayPointerDown} onPointerUp={handleOverlayPointerUp} style={overlayStyle}>
      <style>{dialogControlCss}</style>
      <div aria-hidden="true" style={glassBackdropStyle} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-settings-title"
        style={dialogPanelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={headerStyle}>
          <h2 id="category-settings-title" style={headerTitleStyle}>{category.name}</h2>
        </header>
        <div style={bodyStyle}>
          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>默认模型</span>
            {effectiveModelOptions.length > 0 ? (
              <span className="hesper-category-settings-control hesper-category-settings-model-select" style={modelSelectShellStyle}>
                <ThemedSelect
                  ariaLabel="默认模型"
                  value={draft.defaultModelId}
                  options={['', ...effectiveModelOptions]}
                  {...(hasGroupedOptions ? { optionGroups: modelOptionGroups } : {})}
                  emptyLabel="未设置"
                  minWidth={0}
                  maxWidth={520}
                  menuZIndex={2100}
                  onChange={(value) => setDraft((current) => ({ ...current, defaultModelId: value }))}
                />
              </span>
            ) : (
              <span style={emptyFieldHintStyle}>暂无可用模型</span>
            )}
          </label>

          <div style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>默认工作目录</span>
            <span style={workspaceRowStyle}>
              <span style={workspaceValueStyle} title={draft.workspacePath}>{draft.workspacePath || '未设置'}</span>
              <span style={workspaceActionsStyle}>
                <button ref={initialFocusRef} type="button" className="hesper-category-settings-button" onClick={() => { void handleSelectWorkspace() }} style={smallButtonStyle}>选择</button>
                <button type="button" className="hesper-category-settings-button" onClick={() => setDraft((current) => ({ ...current, workspacePath: '' }))} style={smallButtonStyle}>清除</button>
              </span>
            </span>
          </div>

          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>Soul 设置</span>
            <textarea
              aria-label="Soul 设置"
              value={draft.soul}
              onChange={(event) => {
                const value = event.currentTarget.value
                setDraft((current) => ({ ...current, soul: value }))
              }}
              rows={5}
              className="hesper-category-settings-control"
              style={textareaStyle}
            />
          </label>

          {error ? <p role="alert" style={errorStyle}>{error}</p> : null}
        </div>
        <footer style={footerStyle}>
          <button type="button" className="hesper-category-settings-button" onClick={onClose} disabled={pending} style={secondaryButtonStyle}>取消</button>
          <button type="button" className="hesper-category-settings-button hesper-category-settings-button-primary" onClick={() => onSave(draft)} disabled={pending} style={primaryButtonStyle}>{pending ? '保存中...' : '保存'}</button>
        </footer>
      </div>
    </div>
  )
}

const dialogControlCss = `
.hesper-category-settings-control:focus,
.hesper-category-settings-control:focus-visible,
.hesper-category-settings-button:focus,
.hesper-category-settings-button:focus-visible,
.hesper-category-settings-control button:focus,
.hesper-category-settings-control button:focus-visible {
  outline: none !important;
}

.hesper-category-settings-control:hover:not(:disabled),
.hesper-category-settings-button:hover:not(:disabled) {
  border-color: ${themeTokens.color.textMuted};
  background: ${themeTokens.color.surface};
}

.hesper-category-settings-model-select > div {
  width: 100%;
  max-width: none !important;
}
.hesper-category-settings-model-select > div > button {
  justify-content: space-between !important;
  width: 100%;
}

.hesper-category-settings-model-select > div > button > span {
  flex: 1 1 auto;
}
.hesper-category-settings-button:disabled {
  cursor: default;
  opacity: 0.58;
}

.hesper-category-settings-button-primary:hover:not(:disabled) {
  filter: brightness(0.98);
}
`

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 2000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: themeTokens.spacing.lg
}

const glassBackdropStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.28)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)'
}

const dialogPanelStyle: CSSProperties = {
  position: 'relative',
  width: 'min(560px, 100%)',
  maxHeight: '88vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.xl,
  background: `linear-gradient(180deg, ${themeTokens.color.surface} 0%, ${themeTokens.color.surfaceMuted} 100%)`,
  boxShadow: `0 24px 64px -28px ${themeTokens.color.shadow}`,
  color: themeTokens.color.text
}

const headerStyle: CSSProperties = {
  padding: `${themeTokens.spacing.lg} ${themeTokens.spacing.lg} ${themeTokens.spacing.md}`,
  borderBottom: `1px solid ${themeTokens.color.borderSubtle}`,
  background: themeTokens.color.surface
}

const headerTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.3
}


const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  display: 'grid',
  gap: themeTokens.spacing.md,
  padding: themeTokens.spacing.lg
}

const fieldGroupStyle: CSSProperties = {
  display: 'grid',
  gap: 6
}

const fieldLabelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: themeTokens.color.text
}

const fieldSurfaceStyle: CSSProperties = {
  width: '100%',
  minHeight: 38,
  boxSizing: 'border-box',
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surface,
  color: themeTokens.color.text,
  fontFamily: 'inherit',
  fontSize: 13,
  transition: 'border-color 140ms ease, background 140ms ease, box-shadow 140ms ease'
}

const modelSelectShellStyle: CSSProperties = {
  ...fieldSurfaceStyle,
  display: 'flex',
  alignItems: 'center',
  padding: '0 10px'
}

const emptyFieldHintStyle: CSSProperties = {
  ...fieldSurfaceStyle,
  display: 'flex',
  alignItems: 'center',
  padding: '0 10px',
  color: themeTokens.color.textMuted,
  fontSize: 13
}

const workspaceRowStyle: CSSProperties = {
  ...fieldSurfaceStyle,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 6px 5px 10px'
}

const workspaceValueStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontSize: 13
}

const workspaceActionsStyle: CSSProperties = {
  display: 'flex',
  gap: 4,
  flex: '0 0 auto'
}

const textareaStyle: CSSProperties = {
  ...fieldSurfaceStyle,
  minHeight: 128,
  resize: 'vertical',
  padding: '9px 10px',
  lineHeight: 1.5
}

const errorStyle: CSSProperties = {
  margin: 0,
  padding: '8px 10px',
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.dangerSoft,
  color: themeTokens.color.danger,
  fontSize: 13
}

const footerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: themeTokens.spacing.sm,
  padding: themeTokens.spacing.md,
  borderTop: `1px solid ${themeTokens.color.borderSubtle}`,
  background: themeTokens.color.surface
}

const buttonBaseStyle: CSSProperties = {
  minWidth: 72,
  padding: `7px ${themeTokens.spacing.md}`,
  borderRadius: themeTokens.radius.md,
  fontSize: 13,
  fontFamily: 'inherit',
  fontWeight: 600,
  cursor: 'pointer',
  transition: 'border-color 140ms ease, background 140ms ease, filter 140ms ease, opacity 140ms ease'
}

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  border: 0,
  background: themeTokens.color.accent,
  color: themeTokens.color.accentContrast
}

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  border: `1px solid ${themeTokens.color.border}`,
  background: themeTokens.color.surface,
  color: themeTokens.color.text
}

const smallButtonStyle: CSSProperties = {
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.sm,
  background: themeTokens.color.surfaceMuted,
  color: themeTokens.color.text,
  fontSize: 12,
  fontFamily: 'inherit',
  fontWeight: 600,
  padding: '5px 10px',
  cursor: 'pointer',
  transition: 'border-color 140ms ease, background 140ms ease, opacity 140ms ease'
}
