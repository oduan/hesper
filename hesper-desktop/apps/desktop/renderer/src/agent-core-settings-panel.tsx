import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { darkTheme } from '@hesper/ui'
import type { AppSettings, UpdateSettingsInput } from '../../electron/ipc-contract'

const SAVE_DEBOUNCE_MS = 300
const READONLY_TEXTAREA_MIN_HEIGHT = 160
const EDITING_TEXTAREA_MIN_HEIGHT = 420
const EDITING_TEXTAREA_VIEWPORT_OFFSET = 220
const editingTextareaMinHeight = `min(${EDITING_TEXTAREA_MIN_HEIGHT}px, calc(100vh - ${EDITING_TEXTAREA_VIEWPORT_OFFSET}px))`

type AgentCoreField = 'soul' | 'agents'

type FieldState = Record<AgentCoreField, string>
type EditingState = Record<AgentCoreField, boolean>
type TextareaRefs = Record<AgentCoreField, HTMLTextAreaElement | null>
type TimeoutRefs = Record<AgentCoreField, number | null>

export type AgentCoreSettingsPanelProps = {
  settings: Pick<AppSettings, 'soul' | 'agents'>
  error?: string
  onUpdate: (patch: UpdateSettingsInput) => void | Promise<AppSettings>
}

const fields: Array<{ id: AgentCoreField; title: string; label: string; description: string; placeholder: string }> = [
  {
    id: 'soul',
    title: 'Soul',
    label: '身份设定',
    description: '设置主 Agent 的身份、口吻和行为偏好。',
    placeholder: '写下主 Agent 的身份、口吻、原则或长期行为偏好。'
  },
  {
    id: 'agents',
    title: 'Agents',
    label: 'Agents 配置',
    description: '设置主 Agent 可读取的 agents 配置信息。',
    placeholder: '写下全局 Agents 配置内容。'
  }
]

export function AgentCoreSettingsPanel({ settings, error, onUpdate }: AgentCoreSettingsPanelProps) {
  const currentSettings: FieldState = { soul: settings.soul ?? '', agents: settings.agents ?? '' }
  const [draft, setDraft] = useState<FieldState>(currentSettings)
  const [editing, setEditing] = useState<EditingState>({ soul: false, agents: false })
  const draftRef = useRef<FieldState>(currentSettings)
  const savedRef = useRef<FieldState>(currentSettings)
  const lastSeenSettingsRef = useRef<FieldState>(currentSettings)
  const lastSubmittedRef = useRef<FieldState>(currentSettings)
  const saveTimeoutRef = useRef<TimeoutRefs>({ soul: null, agents: null })
  const onUpdateRef = useRef(onUpdate)
  const textareaRefs = useRef<TextareaRefs>({ soul: null, agents: null })

  const clearPendingSave = useCallback((field: AgentCoreField) => {
    const timeout = saveTimeoutRef.current[field]
    if (timeout !== null) {
      window.clearTimeout(timeout)
      saveTimeoutRef.current[field] = null
    }
  }, [])

  const syncTextareaHeight = useCallback((field: AgentCoreField) => {
    const textarea = textareaRefs.current[field]
    if (!textarea) return

    const availableEditingHeight = Math.max(READONLY_TEXTAREA_MIN_HEIGHT, window.innerHeight - EDITING_TEXTAREA_VIEWPORT_OFFSET)
    const maxHeight = editing[field]
      ? Math.min(EDITING_TEXTAREA_MIN_HEIGHT, availableEditingHeight)
      : READONLY_TEXTAREA_MIN_HEIGHT

    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, READONLY_TEXTAREA_MIN_HEIGHT), maxHeight)}px`
  }, [editing])

  const syncAllTextareaHeights = useCallback(() => {
    for (const field of fields) syncTextareaHeight(field.id)
  }, [syncTextareaHeight])

  const flushDraft = useCallback((field: AgentCoreField) => {
    clearPendingSave(field)

    const nextValue = draftRef.current[field]
    if (nextValue === savedRef.current[field] || nextValue === lastSubmittedRef.current[field]) {
      return
    }

    lastSubmittedRef.current = { ...lastSubmittedRef.current, [field]: nextValue }
    void onUpdateRef.current({ [field]: nextValue })
  }, [clearPendingSave])

  useEffect(() => {
    onUpdateRef.current = onUpdate
  }, [onUpdate])

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    const nextSettings: FieldState = { soul: settings.soul ?? '', agents: settings.agents ?? '' }
    setDraft((current) => {
      let changed = false
      const next = { ...current }
      for (const field of fields) {
        const key = field.id
        if (nextSettings[key] === lastSeenSettingsRef.current[key]) continue
        const previousSaved = savedRef.current[key]
        savedRef.current = { ...savedRef.current, [key]: nextSettings[key] }
        lastSeenSettingsRef.current = { ...lastSeenSettingsRef.current, [key]: nextSettings[key] }
        lastSubmittedRef.current = { ...lastSubmittedRef.current, [key]: nextSettings[key] }
        if (current[key] === previousSaved) {
          next[key] = nextSettings[key]
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [settings.agents, settings.soul])

  useEffect(() => {
    for (const field of fields) {
      clearPendingSave(field.id)
      if (draft[field.id] !== savedRef.current[field.id]) {
        saveTimeoutRef.current[field.id] = window.setTimeout(() => flushDraft(field.id), SAVE_DEBOUNCE_MS)
      }
    }

    return () => {
      for (const field of fields) clearPendingSave(field.id)
    }
  }, [clearPendingSave, draft, flushDraft])

  useLayoutEffect(() => {
    syncAllTextareaHeights()
  }, [draft, editing, syncAllTextareaHeights])

  useEffect(() => {
    window.addEventListener('resize', syncAllTextareaHeights)
    return () => window.removeEventListener('resize', syncAllTextareaHeights)
  }, [syncAllTextareaHeights])

  useEffect(() => {
    for (const field of fields) {
      if (editing[field.id]) textareaRefs.current[field.id]?.focus()
    }
  }, [editing])

  useEffect(() => () => {
    for (const field of fields) clearPendingSave(field.id)
  }, [clearPendingSave])

  return (
    <section aria-label="Agent Core 设置面板" style={panelStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>Agent Core</h2>
        <p style={descriptionStyle}>配置主 Agent 的长期行为核心。</p>
      </header>

      {error ? <p role="alert" style={errorStyle}>设置保存失败：{error}</p> : null}

      <div style={cardStyle}>
        {fields.map((field) => (
          <div key={field.id} style={fieldStyle}>
            <div style={fieldTitleBlockStyle}>
              <h3 style={sectionTitleStyle}>{field.title}</h3>
              <p style={sectionDescriptionStyle}>{field.description}</p>
            </div>
            <div style={fieldHeaderStyle}>
              <span style={labelStyle}>{field.label}</span>
              <button
                type="button"
                aria-label={`编辑 ${field.title}`}
                onClick={() => setEditing((current) => ({ ...current, [field.id]: true }))}
                style={editButtonStyle}
              >
                编辑
              </button>
            </div>
            <textarea
              ref={(element) => { textareaRefs.current[field.id] = element }}
              aria-label={field.label}
              aria-readonly={!editing[field.id]}
              readOnly={!editing[field.id]}
              value={draft[field.id]}
              onChange={(event) => {
                if (!editing[field.id]) return
                const value = event.target.value
                setDraft((current) => ({ ...current, [field.id]: value }))
              }}
              onBlur={() => {
                flushDraft(field.id)
                setEditing((current) => ({ ...current, [field.id]: false }))
              }}
              placeholder={field.placeholder}
              rows={8}
              className="hesper-theme-scrollbar"
              style={getTextareaStyle(editing[field.id])}
            />
          </div>
        ))}
      </div>
    </section>
  )
}

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  overflowX: 'auto',
  overflowY: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: darkTheme.spacing.lg,
  paddingRight: 4,
  color: darkTheme.color.text,
  fontSize: darkTheme.typography.body
}

const headerStyle: CSSProperties = {
  display: 'grid',
  gap: 6
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'calc(var(--hesper-font-size, 14px) + 6px)',
  lineHeight: 1.2
}

const descriptionStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted,
  lineHeight: 1.6
}

const cardStyle: CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  display: 'grid',
  gap: darkTheme.spacing.xl
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 8
}

const fieldTitleBlockStyle: CSSProperties = {
  display: 'grid',
  gap: 4
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 15,
  lineHeight: 1.3
}

const sectionDescriptionStyle: CSSProperties = {
  margin: 0,
  color: darkTheme.color.textMuted,
  lineHeight: 1.5
}

const fieldHeaderStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: darkTheme.spacing.md
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontWeight: 700
}

const editButtonStyle: CSSProperties = {
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surface,
  color: darkTheme.color.text,
  padding: '4px 10px',
  font: 'inherit',
  lineHeight: 1.4,
  cursor: 'pointer'
}

const textareaBaseStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  color: 'var(--hesper-color-text, #c0caf5)',
  minHeight: READONLY_TEXTAREA_MIN_HEIGHT,
  maxHeight: editingTextareaMinHeight,
  overflowX: 'hidden',
  overflowY: 'auto',
  resize: 'none',
  fontFamily: 'inherit',
  lineHeight: 1.5
}

function getTextareaStyle(isEditing: boolean): CSSProperties {
  return {
    ...textareaBaseStyle,
    minHeight: isEditing ? editingTextareaMinHeight : READONLY_TEXTAREA_MIN_HEIGHT,
    maxHeight: isEditing ? editingTextareaMinHeight : READONLY_TEXTAREA_MIN_HEIGHT,
    borderStyle: isEditing ? 'solid' : 'none',
    borderWidth: isEditing ? 1 : 0,
    borderColor: darkTheme.color.border,
    borderRadius: isEditing ? darkTheme.radius.md : 0,
    backgroundColor: isEditing ? darkTheme.color.surfaceMuted : 'transparent',
    padding: isEditing ? '12px' : '12px 0'
  }
}

const errorStyle: CSSProperties = {
  margin: 0,
  border: `1px solid ${darkTheme.color.danger}`,
  borderRadius: darkTheme.radius.md,
  background: 'rgba(255, 123, 123, 0.12)',
  color: darkTheme.color.danger,
  padding: darkTheme.spacing.md
}
