import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ThemedSelect } from '../conversation/ThemedSelect'
import { themeTokens } from '../theme'

export type CategorySettingsValue = {
  defaultModelId: string
  workspacePath: string
  soul: string
  soulOverrideEnabled: boolean
  agents: string
  agentsOverrideEnabled: boolean
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
  soulOverrideEnabled?: boolean
  agents?: string
  agentsOverrideEnabled?: boolean
  pending?: boolean
  error?: string
  onSave: (value: CategorySettingsValue) => void
  onClose: () => void
  onSelectWorkspace: () => string | undefined | Promise<string | undefined>
}

type DialogDraft = CategorySettingsValue

function buildDraft(props: Pick<CategorySettingsDialogProps, 'defaultModelId' | 'workspacePath' | 'soul' | 'soulOverrideEnabled' | 'agents' | 'agentsOverrideEnabled'>): DialogDraft {
  return {
    defaultModelId: props.defaultModelId ?? '',
    workspacePath: props.workspacePath ?? '',
    soul: props.soul ?? '',
    soulOverrideEnabled: props.soulOverrideEnabled ?? false,
    agents: props.agents ?? '',
    agentsOverrideEnabled: props.agentsOverrideEnabled ?? false
  }
}

export function CategorySettingsDialog(props: CategorySettingsDialogProps) {
  const { category, modelOptions = [], modelOptionGroups = [], pending = false, error, onSave, onClose, onSelectWorkspace } = props
  const [draft, setDraft] = useState<DialogDraft>(() => buildDraft(props))
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const initialFocusRef = useRef<HTMLButtonElement>(null)
  const soulTextareaRef = useRef<HTMLTextAreaElement>(null)
  const agentsTextareaRef = useRef<HTMLTextAreaElement>(null)
  const overlayPointerDownStartedRef = useRef(false)

  useEffect(() => {
    setDraft(buildDraft(props))
  }, [category.id, props.defaultModelId, props.workspacePath, props.soul, props.soulOverrideEnabled, props.agents, props.agentsOverrideEnabled])

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

  useLayoutEffect(() => {
    adjustOverrideTextareaHeight(soulTextareaRef.current, bodyRef.current)
    adjustOverrideTextareaHeight(agentsTextareaRef.current, bodyRef.current)
  }, [draft.soul, draft.agents, draft.soulOverrideEnabled, draft.agentsOverrideEnabled])

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
  const selectOptions = modelOptionGroups.length > 0 ? [''] : ['', ...effectiveModelOptions]
  const hasGroupedOptions = modelOptionGroups.length > 0
  const renderOverrideTextarea = (label: string, value: string, textareaRef: RefObject<HTMLTextAreaElement | null>, onChange: (value: string) => void) => (
    <textarea
      ref={textareaRef}
      aria-label={label}
      value={value}
      onChange={(event) => {
        adjustOverrideTextareaHeight(event.currentTarget, bodyRef.current)
        onChange(event.currentTarget.value)
      }}
      rows={5}
      className="hesper-category-settings-control hesper-theme-scrollbar"
      style={textareaStyle}
    />
  )
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
        <div ref={bodyRef} className="hesper-theme-scrollbar" style={bodyStyle}>
          <label style={fieldGroupStyle}>
            <span style={fieldLabelStyle}>默认模型</span>
            {effectiveModelOptions.length > 0 ? (
              <span className="hesper-category-settings-control hesper-category-settings-model-select" style={modelSelectShellStyle}>
                <ThemedSelect
                  ariaLabel="默认模型"
                  value={draft.defaultModelId}
                  options={selectOptions}
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

          <div style={fieldGroupStyle}>
            <div style={overrideHeaderStyle}>
              <span style={fieldLabelStyle}>Soul 设置</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.soulOverrideEnabled}
                aria-label="Soul 设置覆盖开关"
                className="hesper-category-settings-switch"
                style={switchButtonStyle(draft.soulOverrideEnabled)}
                onClick={() => setDraft((current) => ({ ...current, soulOverrideEnabled: !current.soulOverrideEnabled }))}
              >
                <span aria-hidden="true" style={switchKnobStyle(draft.soulOverrideEnabled)} />
              </button>
            </div>
            {draft.soulOverrideEnabled ? renderOverrideTextarea('Soul 设置', draft.soul, soulTextareaRef, (soul) => setDraft((current) => ({ ...current, soul }))) : null}
          </div>

          <div style={fieldGroupStyle}>
            <div style={overrideHeaderStyle}>
              <span style={fieldLabelStyle}>Agents 配置</span>
              <button
                type="button"
                role="switch"
                aria-checked={draft.agentsOverrideEnabled}
                aria-label="Agents 配置覆盖开关"
                className="hesper-category-settings-switch"
                style={switchButtonStyle(draft.agentsOverrideEnabled)}
                onClick={() => setDraft((current) => ({ ...current, agentsOverrideEnabled: !current.agentsOverrideEnabled }))}
              >
                <span aria-hidden="true" style={switchKnobStyle(draft.agentsOverrideEnabled)} />
              </button>
            </div>
            {draft.agentsOverrideEnabled ? renderOverrideTextarea('Agents 配置', draft.agents, agentsTextareaRef, (agents) => setDraft((current) => ({ ...current, agents }))) : null}
          </div>

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
.hesper-category-settings-switch:focus,
.hesper-category-settings-switch:focus-visible,
.hesper-category-settings-control button:focus,
.hesper-category-settings-control button:focus-visible {
  outline: none !important;
}

.hesper-category-settings-control:hover:not(:disabled),
.hesper-category-settings-button:hover:not(:disabled) {
  border-color: ${themeTokens.color.textMuted};
  background: ${themeTokens.color.surface};
}

.hesper-category-settings-switch:hover:not(:disabled) {
  border-color: ${themeTokens.color.textMuted};
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

const overrideHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: themeTokens.spacing.md
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

function switchButtonStyle(enabled: boolean): CSSProperties {
  return {
    width: 42,
    height: 24,
    border: `1px solid ${enabled ? themeTokens.color.accent : themeTokens.color.border}`,
    borderRadius: 999,
    background: enabled ? themeTokens.color.accent : themeTokens.color.surfaceMuted,
    display: 'inline-flex',
    alignItems: 'center',
    padding: 2,
    cursor: 'pointer',
    transition: 'background 160ms ease, border-color 160ms ease'
  }
}

function switchKnobStyle(enabled: boolean): CSSProperties {
  return {
    width: 18,
    height: 18,
    borderRadius: 999,
    background: enabled ? themeTokens.color.accentContrast : themeTokens.color.textMuted,
    boxShadow: `0 2px 6px ${themeTokens.color.shadow}`,
    transform: enabled ? 'translateX(18px)' : 'translateX(0)',
    transition: 'transform 160ms ease, background 160ms ease'
  }
}
const textareaMinHeight = 128
const textareaMaxHeight = 384

function adjustOverrideTextareaHeight(textarea: HTMLTextAreaElement | null, scrollContainer?: HTMLElement | null) {
  if (!textarea) return
  const previousScrollTop = scrollContainer?.scrollTop
  textarea.style.height = 'auto'
  const nextHeight = Math.max(textareaMinHeight, Math.min(textarea.scrollHeight, textareaMaxHeight))
  textarea.style.height = `${nextHeight}px`
  textarea.style.overflowY = textarea.scrollHeight > textareaMaxHeight ? 'auto' : 'hidden'
  if (scrollContainer && previousScrollTop !== undefined) scrollContainer.scrollTop = previousScrollTop
}

const textareaStyle: CSSProperties = {
  ...fieldSurfaceStyle,
  minHeight: 128,
  maxHeight: 384,
  overflowY: 'auto',
  resize: 'none',
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
