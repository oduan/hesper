import type { CSSProperties } from 'react'
import type { ToolDto } from '../../electron/ipc-contract'

export function ToolDetailsPanel({
  tool,
  pending = false,
  error,
  onToggle
}: {
  tool?: ToolDto
  pending?: boolean
  error?: string
  onToggle?: (enabled: boolean) => void
}) {
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

  return (
    <section aria-label="工具详情" style={panelStyle}>
      <header style={headerStyle}>
        <div style={{ minWidth: 0 }}>
          <p style={eyebrowStyle}>内置工具</p>
          <h2 style={titleStyle}>{tool.name}</h2>
          <p style={descriptionStyle}>{tool.description}</p>
        </div>
        <ToolDetailSwitch enabled={tool.enabled} pending={pending} onToggle={() => onToggle?.(!tool.enabled)} />
      </header>

      {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}

      {!tool.enabled ? (
        <div style={disabledNoticeStyle}>
          当前工具已全局关闭。它不会被写入 Agent prompt，也不会注册为 Agent 可调用工具；即使角色或会话允许该工具，运行时也会拒绝执行。
        </div>
      ) : null}

      <div style={infoGridStyle}>
        <InfoItem label="工具 ID" value={tool.id} />
        <InfoItem label="分类" value={tool.category} />
        <InfoItem label="来源" value="builtin" />
        <InfoItem label="全局状态" value={tool.enabled ? '开启' : '关闭'} />
      </div>

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

function ToolDetailSwitch({ enabled, pending, onToggle }: { enabled: boolean; pending: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      aria-label="工具全局开关"
      disabled={pending}
      onClick={onToggle}
      style={detailSwitchStyle(enabled, pending)}
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

const disabledNoticeStyle: CSSProperties = {
  padding: '12px 14px',
  borderRadius: 14,
  border: '1px solid rgba(247, 118, 142, 0.32)',
  background: 'rgba(247, 118, 142, 0.10)',
  color: 'var(--hesper-color-danger, #f7768e)',
  lineHeight: 1.55
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

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 14
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
    border: `1px solid ${enabled ? 'var(--hesper-color-accent, #7aa2f7)' : 'var(--hesper-color-border, #414868)'}`,
    background: enabled ? 'var(--hesper-color-accent, #7aa2f7)' : 'var(--hesper-color-surface-muted, #24283b)',
    boxShadow: enabled ? '0 0 0 3px var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))' : 'inset 0 0 0 1px rgba(148, 163, 184, 0.10)',
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
    color: enabled ? 'var(--hesper-color-accent, #7aa2f7)' : 'var(--hesper-color-text-muted, #737aa2)',
    whiteSpace: 'nowrap'
  }
}
