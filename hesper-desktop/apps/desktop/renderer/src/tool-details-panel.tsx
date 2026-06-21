import { useState, type CSSProperties, type FormEvent } from 'react'
import type { ToolCredentialStatus, ToolDto } from '../../electron/ipc-contract'

type ToolDetailsPanelProps = {
  tool?: ToolDto
  pending?: boolean
  credentialPending?: boolean
  credentialStatus?: ToolCredentialStatus
  error?: string
  onToggle?: (enabled: boolean) => void
  onSaveApiKey?: (apiKey: string) => void
  onDeleteApiKey?: () => void
}

export function ToolDetailsPanel({
  tool,
  pending = false,
  error,
  credentialPending = false,
  credentialStatus,
  onToggle,
  onSaveApiKey,
  onDeleteApiKey
}: ToolDetailsPanelProps) {
  if (!tool) {
    return (
      <section aria-label="工具详情" style={emptyStateStyle}>
        <div>
          <h2 style={emptyTitleStyle}>选择一个工具</h2>
          <p style={mutedTextStyle}>从左侧工具列表中选择内置工具后，这里会展示它的定义、输入参数和全局启用状态。</p>
          {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}
        </div>
      </section>
    )
  }

  const canToggle = !tool.requiresApiKey || tool.hasApiKey === true

  return (
    <section aria-label="工具详情" style={panelStyle}>
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <p style={eyebrowStyle}>内置工具</p>
          <h2 style={titleStyle}>{tool.name}</h2>
          <p style={descriptionStyle}>{tool.description}</p>
        </div>
        <ToolDetailSwitch enabled={tool.enabled} pending={pending} disabled={!canToggle} onToggle={() => onToggle?.(!tool.enabled)} />
      </header>

      {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}

      <div style={infoGridStyle}>
        <InfoItem label="工具 ID" value={tool.id} />
        <InfoItem label="分类" value={tool.category} />
        <InfoItem label="来源" value="builtin" />
        <InfoItem label="全局状态" value={tool.enabled ? '开启' : '关闭'} />
        {tool.requiresApiKey ? <InfoItem label="API Key" value={tool.hasApiKey ? '已保存' : '未保存'} /> : null}
      </div>

      {tool.requiresApiKey ? (
        <ToolApiKeySection
          tool={tool}
          pending={credentialPending}
          {...(credentialStatus ? { status: credentialStatus } : {})}
          {...(onSaveApiKey ? { onSaveApiKey } : {})}
          {...(onDeleteApiKey ? { onDeleteApiKey } : {})}
        />
      ) : null}

      <section style={sectionStyle}>
        <h3 style={sectionTitleStyle}>输入参数 Schema</h3>
        <pre className="hesper-theme-scrollbar" style={schemaBlockStyle}>{JSON.stringify(tool.inputSchema, null, 2)}</pre>
      </section>
    </section>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div style={infoItemStyle}>
      <span style={infoLabelStyle}>{label}</span>
      <span style={infoValueStyle}>{value}</span>
    </div>
  )
}

function ToolApiKeySection({
  tool,
  pending,
  status,
  onSaveApiKey,
  onDeleteApiKey
}: {
  tool: ToolDto
  pending: boolean
  status?: ToolCredentialStatus
  onSaveApiKey?: (apiKey: string) => void
  onDeleteApiKey?: () => void
}) {
  const [apiKey, setApiKey] = useState('')
  const hasApiKey = status?.hasApiKey ?? tool.hasApiKey === true
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmed = apiKey.trim()
    if (!trimmed || pending) return
    onSaveApiKey?.(trimmed)
    setApiKey('')
  }

  return (
    <section aria-label="工具 API Key" style={apiKeySectionStyle}>
      <div style={{ minWidth: 0 }}>
        <h3 style={sectionTitleStyle}>API Key</h3>
        <p style={mutedTextStyle}>这个工具需要先保存 API key 才能全局开启或注入给 Agent。密钥只保存在本地凭据库，不会写入 prompt。</p>
        {status?.warning ? <p style={warningTextStyle}>{status.warning}</p> : null}
      </div>
      <div style={apiKeyStatusRowStyle}>
        <span style={apiKeyStatusBadgeStyle(hasApiKey)}>{hasApiKey ? '已保存' : '未保存'}</span>
        {status?.updatedAt ? <span style={apiKeyUpdatedStyle}>更新于 {new Date(status.updatedAt).toLocaleString()}</span> : null}
      </div>
      <form onSubmit={submit} style={apiKeyFormStyle}>
        <label style={apiKeyInputLabelStyle}>
          <span>TinyFish API Key</span>
          <input
            type="password"
            value={apiKey}
            disabled={pending}
            placeholder="粘贴 TinyFish API key"
            onChange={(event) => setApiKey(event.target.value)}
            style={apiKeyInputStyle}
          />
        </label>
        <div style={apiKeyButtonRowStyle}>
          <button type="submit" disabled={pending || !apiKey.trim()} style={primaryButtonStyle(pending || !apiKey.trim())}>保存 API Key</button>
          {hasApiKey ? <button type="button" disabled={pending} onClick={onDeleteApiKey} style={secondaryButtonStyle(pending)}>删除 API Key</button> : null}
        </div>
      </form>
    </section>
  )
}

function ToolDetailSwitch({ enabled, pending, disabled, onToggle }: { enabled: boolean; pending: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="工具全局开关"
      disabled={pending || disabled}
      onClick={onToggle}
      style={detailSwitchStyle(enabled, pending || disabled)}
    >
      <span aria-hidden="true" data-tool-toggle-track="true" style={detailSwitchTrackStyle(enabled)}>
        <span data-tool-toggle-knob="true" style={detailSwitchKnobStyle(enabled)} />
      </span>
      <span style={detailSwitchLabelStyle(enabled)}>{enabled ? '全局开启' : '全局关闭'}</span>
    </button>
  )
}

const panelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  overflow: 'auto',
  paddingRight: 4
}

const emptyStateStyle: CSSProperties = {
  height: '100%',
  display: 'grid',
  placeItems: 'center',
  textAlign: 'center',
  padding: 24
}

const emptyTitleStyle: CSSProperties = {
  margin: '0 0 8px',
  fontSize: 16
}

const headerStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'start',
  gap: 18,
  padding: 18,
  border: '1px solid var(--hesper-color-border, #414868)',
  borderRadius: 16,
  background: 'var(--hesper-color-surface-muted, #24283b)'
}

const eyebrowStyle: CSSProperties = {
  margin: '0 0 8px',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase'
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: 20,
  lineHeight: 1.25
}

const descriptionStyle: CSSProperties = {
  margin: '10px 0 0',
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  lineHeight: 1.55
}

const mutedTextStyle: CSSProperties = {
  margin: 0,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  lineHeight: 1.55
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  borderRadius: 12,
  color: 'var(--hesper-color-danger, #f7768e)',
  background: 'rgba(247, 118, 142, 0.12)'
}

const infoGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 10
}

const infoItemStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 6,
  padding: 14,
  borderRadius: 14,
  background: 'var(--hesper-color-surface-muted, #24283b)',
  border: '1px solid var(--hesper-color-border, #414868)'
}

const infoLabelStyle: CSSProperties = {
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.04em'
}

const infoValueStyle: CSSProperties = {
  minWidth: 0,
  overflowWrap: 'anywhere',
  fontWeight: 700
}

const sectionStyle: CSSProperties = {
  minHeight: 0,
  display: 'grid',
  gap: 10
}

const apiKeySectionStyle: CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 16,
  borderRadius: 16,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'var(--hesper-color-surface-muted, #24283b)'
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14
}

const warningTextStyle: CSSProperties = {
  margin: '8px 0 0',
  color: 'var(--hesper-color-warning, #e0af68)',
  lineHeight: 1.45
}

const apiKeyStatusRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap'
}

function apiKeyStatusBadgeStyle(hasApiKey: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: 999,
    padding: '4px 10px',
    fontSize: 12,
    fontWeight: 800,
    color: hasApiKey ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-text-muted, #737aa2)',
    background: hasApiKey ? 'var(--hesper-color-tool-toggle-soft, rgba(122, 162, 247, 0.14))' : 'rgba(148, 163, 184, 0.12)'
  }
}

const apiKeyUpdatedStyle: CSSProperties = {
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 12
}

const apiKeyFormStyle: CSSProperties = {
  display: 'grid',
  gap: 12
}

const apiKeyInputLabelStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  fontSize: 12,
  fontWeight: 800
}

const apiKeyInputStyle: CSSProperties = {
  minHeight: 34,
  borderRadius: 10,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'var(--hesper-color-surface, #1f2335)',
  color: 'var(--hesper-color-text, #c0caf5)',
  padding: '0 10px',
  outline: 'none'
}

const apiKeyButtonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap'
}

function primaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    minHeight: 32,
    border: 0,
    borderRadius: 10,
    padding: '0 12px',
    background: 'var(--hesper-color-tool-toggle, #7aa2f7)',
    color: 'var(--hesper-color-surface, #16161e)',
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1
  }
}

function secondaryButtonStyle(disabled: boolean): CSSProperties {
  return {
    minHeight: 32,
    border: '1px solid var(--hesper-color-border, #414868)',
    borderRadius: 10,
    padding: '0 12px',
    background: 'transparent',
    color: 'var(--hesper-color-text-muted, #9aa5ce)',
    fontWeight: 800,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1
  }
}

const schemaBlockStyle: CSSProperties = {
  margin: 0,
  maxHeight: 320,
  overflow: 'auto',
  padding: 14,
  borderRadius: 14,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'rgba(0, 0, 0, 0.18)',
  color: 'var(--hesper-color-text, #c0caf5)',
  fontSize: 12,
  lineHeight: 1.5
}

function detailSwitchStyle(_enabled: boolean, pending: boolean): CSSProperties {
  return {
    minHeight: 32,
    border: 0,
    borderRadius: 999,
    background: 'transparent',
    color: 'var(--hesper-color-text, #c0caf5)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 0,
    fontWeight: 800,
    cursor: pending ? 'progress' : 'pointer',
    opacity: pending ? 0.62 : 1
  }
}

function detailSwitchTrackStyle(enabled: boolean): CSSProperties {
  return {
    position: 'relative',
    width: 46,
    height: 24,
    borderRadius: 999,
    border: `1px solid ${enabled ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-border, #414868)'}`,
    background: enabled ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-surface-muted, #24283b)',
    boxShadow: enabled ? '0 0 0 3px var(--hesper-color-tool-toggle-soft, rgba(122, 162, 247, 0.14))' : 'inset 0 0 0 1px rgba(148, 163, 184, 0.10)',
    transition: 'background 160ms ease, border-color 160ms ease, box-shadow 160ms ease'
  }
}

function detailSwitchKnobStyle(enabled: boolean): CSSProperties {
  return {
    position: 'absolute',
    top: 2,
    left: 2,
    width: 18,
    height: 18,
    borderRadius: 999,
    background: enabled ? 'var(--hesper-color-surface, #16161e)' : 'var(--hesper-color-text-muted, #737aa2)',
    boxShadow: enabled ? '0 3px 10px rgba(0, 0, 0, 0.24)' : '0 2px 7px rgba(0, 0, 0, 0.18)',
    transform: enabled ? 'translateX(22px)' : 'translateX(0)',
    transition: 'transform 160ms ease, background 160ms ease, box-shadow 160ms ease'
  }
}

function detailSwitchLabelStyle(enabled: boolean): CSSProperties {
  return {
    color: enabled ? 'var(--hesper-color-tool-toggle, #7aa2f7)' : 'var(--hesper-color-text-muted, #737aa2)',
    whiteSpace: 'nowrap'
  }
}
