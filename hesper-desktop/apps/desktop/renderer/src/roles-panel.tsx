import { useEffect, useState, type CSSProperties } from 'react'
import type { ManagedRoleDto, ToolDto } from '../../electron/ipc-contract'

type RolesPanelProps = {
  roles: ManagedRoleDto[]
  selectedRole?: ManagedRoleDto
  tools: ToolDto[]
  pending?: boolean
  loading?: boolean
  error?: string
  onSave?: (role: ManagedRoleDto) => void
  onDelete?: (roleId: string) => void
}

function emptyDraft(): ManagedRoleDto {
  return {
    id: '',
    name: '',
    description: '',
    systemPrompt: '',
    defaultToolIds: []
  }
}

function cloneRole(role: ManagedRoleDto): ManagedRoleDto {
  return {
    id: role.id,
    name: role.name,
    description: role.description,
    systemPrompt: role.systemPrompt,
    defaultToolIds: [...role.defaultToolIds]
  }
}

function sameToolIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return sortedLeft.every((id, index) => id === sortedRight[index])
}

function roleDraftChanged(draft: ManagedRoleDto, selectedRole: ManagedRoleDto | undefined): boolean {
  if (!selectedRole) return true
  return draft.name.trim() !== selectedRole.name.trim()
    || draft.description.trim() !== selectedRole.description.trim()
    || draft.systemPrompt.trim() !== selectedRole.systemPrompt.trim()
    || !sameToolIds(draft.defaultToolIds, selectedRole.defaultToolIds)
}

export function RolesPanel({
  roles,
  selectedRole,
  tools,
  pending = false,
  loading = false,
  error,
  onSave,
  onDelete
}: RolesPanelProps) {
  const [draft, setDraft] = useState<ManagedRoleDto>(() => selectedRole ? cloneRole(selectedRole) : emptyDraft())
  const isExistingRole = Boolean(selectedRole)
  const canEdit = Boolean(selectedRole)
  const trimmedName = draft.name.trim()
  const hasDraftChanges = roleDraftChanged(draft, selectedRole)
  const canSave = Boolean(trimmedName) && !pending && hasDraftChanges

  useEffect(() => {
    if (selectedRole) {
      setDraft(cloneRole(selectedRole))
      return
    }
    setDraft(emptyDraft())
  }, [selectedRole])

  const updateField = (field: 'name' | 'description' | 'systemPrompt', value: string) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const toggleTool = (toolId: string) => {
    setDraft((current) => {
      const toolIds = current.defaultToolIds.includes(toolId)
        ? current.defaultToolIds.filter((id) => id !== toolId)
        : [...current.defaultToolIds, toolId]
      return { ...current, defaultToolIds: toolIds }
    })
  }

  const saveDraft = () => {
    if (!canSave) return
    onSave?.({
      id: draft.id,
      name: trimmedName,
      description: draft.description.trim(),
      systemPrompt: draft.systemPrompt.trim(),
      defaultToolIds: [...draft.defaultToolIds]
    })
  }

  const deleteRole = () => {
    if (!selectedRole || pending) return
    if (window.confirm(`确定要删除角色“${selectedRole.name}”吗？此操作无法撤销。`)) {
      onDelete?.(selectedRole.id)
    }
  }

  if (loading && !canEdit) {
    return (
      <section aria-label="角色管理" style={emptyStateStyle}>
        <div>
          <h2 style={emptyTitleStyle}>角色加载中…</h2>
          <p style={mutedTextStyle}>正在加载角色列表，请稍候。</p>
        </div>
      </section>
    )
  }

  if (!canEdit && roles.length === 0) {
    return (
      <section aria-label="角色管理" style={emptyStateStyle}>
        <div>
          <h2 style={emptyTitleStyle}>暂无角色</h2>
          <p style={mutedTextStyle}>请让 Agent 创建角色后，再在这里维护名称、简介、提示词和默认工具。</p>
        </div>
        {error ? <p role="alert" style={errorStyle}>{error}</p> : null}
      </section>
    )
  }

  if (!canEdit) {
    return (
      <section aria-label="角色管理" style={emptyStateStyle}>
        {error ? <p role="alert" style={errorStyle}>{error}</p> : null}
        <p style={mutedTextStyle}>请选择一个角色；新角色请通过 Agent 创建。</p>
      </section>
    )
  }

  return (
    <section aria-label="角色管理" style={panelStyle}>
      <header style={headerStyle}>
        <div>
          <h2 style={titleStyle}>编辑角色</h2>
          <p style={mutedTextStyle}>角色仅用于管理预设内容；当前不会影响会话运行逻辑。</p>
        </div>
      </header>

      {error ? <p role="alert" style={errorStyle}>{error}</p> : null}

      <div style={formGridStyle}>
        <label style={fieldStyle}>
          <span style={labelStyle}>角色名称</span>
          <input
            value={draft.name}
            onChange={(event) => updateField('name', event.target.value)}
            disabled={pending}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>角色简介</span>
          <input
            value={draft.description}
            onChange={(event) => updateField('description', event.target.value)}
            disabled={pending}
            style={inputStyle}
          />
        </label>

        <label style={fieldStyle}>
          <span style={labelStyle}>完整提示词</span>
          <textarea
            value={draft.systemPrompt}
            onChange={(event) => updateField('systemPrompt', event.target.value)}
            disabled={pending}
            rows={8}
            style={textareaStyle}
          />
        </label>

        <fieldset style={fieldsetStyle}>
          <legend style={legendStyle}>默认工具</legend>
          {tools.length > 0 ? (
            <div style={toolListStyle}>
              {tools.map((tool) => (
                <label key={tool.id} style={toolRowStyle}>
                  <input
                    type="checkbox"
                    aria-label={tool.name}
                    checked={draft.defaultToolIds.includes(tool.id)}
                    disabled={pending}
                    onChange={() => toggleTool(tool.id)}
                  />
                  <span style={toolTextStyle}>
                    <span style={toolNameStyle}>{tool.name}</span>
                    <span style={toolDescriptionStyle}>{tool.description}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p style={mutedTextStyle}>暂无可用工具</p>
          )}
        </fieldset>
      </div>

      <footer style={footerStyle}>
        {isExistingRole ? (
          <button type="button" onClick={deleteRole} disabled={pending} style={dangerButtonStyle}>
            删除角色
          </button>
        ) : <span />}
        <button type="button" onClick={saveDraft} disabled={!canSave} style={canSave ? primaryButtonStyle : disabledButtonStyle}>
          保存修改
        </button>
      </footer>
    </section>
  )
}

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  overflow: 'hidden'
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 16
}

const titleStyle: CSSProperties = {
  margin: '0 0 6px',
  fontSize: 18,
  lineHeight: 1.3
}

const emptyStateStyle: CSSProperties = {
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  alignContent: 'center',
  gap: 16,
  textAlign: 'center',
  padding: 24
}

const emptyTitleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 18
}

const mutedTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 13,
  lineHeight: 1.6
}

const errorStyle: CSSProperties = {
  margin: 0,
  border: '1px solid rgba(252, 165, 165, 0.35)',
  borderRadius: 10,
  background: 'rgba(127, 29, 29, 0.20)',
  color: '#fca5a5',
  padding: '10px 12px'
}

const formGridStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  gap: 14,
  paddingRight: 4
}

const fieldStyle: CSSProperties = {
  display: 'grid',
  gap: 8
}

const labelStyle: CSSProperties = {
  fontSize: 13,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontWeight: 700
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--hesper-color-border, #414868)',
  borderRadius: 10,
  background: 'var(--hesper-color-surface-muted, #24283b)',
  color: 'var(--hesper-color-text, #c0caf5)',
  padding: '10px 12px',
  outline: 'none'
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 160,
  resize: 'vertical',
  fontFamily: 'inherit',
  lineHeight: 1.5
}

const fieldsetStyle: CSSProperties = {
  margin: 0,
  border: '1px solid var(--hesper-color-border, #414868)',
  borderRadius: 12,
  padding: 12
}

const legendStyle: CSSProperties = {
  padding: '0 6px',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 13,
  fontWeight: 700
}

const toolListStyle: CSSProperties = {
  display: 'grid',
  gap: 8
}

const toolRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  borderRadius: 10,
  background: 'rgba(255, 255, 255, 0.03)',
  padding: 10,
  cursor: 'pointer'
}

const toolTextStyle: CSSProperties = {
  display: 'grid',
  gap: 3
}

const toolNameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700
}

const toolDescriptionStyle: CSSProperties = {
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 12,
  lineHeight: 1.45
}

const footerStyle: CSSProperties = {
  marginTop: 'auto',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12
}

const buttonBaseStyle: CSSProperties = {
  border: 0,
  borderRadius: 10,
  padding: '10px 16px',
  fontWeight: 700,
  cursor: 'pointer'
}

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'var(--hesper-color-accent, #7c6cff)',
  color: '#ffffff'
}

const disabledButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: 'var(--hesper-color-surface-muted, #24283b)',
  color: 'var(--hesper-color-text-muted, #737aa2)',
  cursor: 'not-allowed'
}

const dangerButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'var(--hesper-color-danger, #ef4444)',
  background: 'var(--hesper-color-danger-soft, rgba(220, 38, 38, 0.20))',
  color: 'var(--hesper-color-danger-strong, #dc2626)'
}
