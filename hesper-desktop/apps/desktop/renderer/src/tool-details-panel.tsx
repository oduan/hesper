import { useState, type CSSProperties, type FormEvent } from 'react'
import type { CreateSshKeyInput, CreateSshServerInput, SshKeyDto, SshServerDto, ToolCredentialStatus, ToolDto, UpdateSshServerInput } from '../../electron/ipc-contract'

type ToolDetailsPanelProps = {
  tool?: ToolDto
  pending?: boolean
  credentialPending?: boolean
  credentialStatus?: ToolCredentialStatus
  error?: string
  sshKeys?: SshKeyDto[]
  sshServers?: SshServerDto[]
  sshPending?: boolean
  onToggle?: (enabled: boolean) => void
  onSaveApiKey?: (apiKey: string) => void
  onDeleteApiKey?: () => void
  onCreateSshKey?: (input: CreateSshKeyInput) => void | Promise<void>
  onDeleteSshKey?: (keyId: string) => void | Promise<void>
  onCreateSshServer?: (input: CreateSshServerInput) => void | Promise<void>
  onUpdateSshServer?: (input: UpdateSshServerInput) => void | Promise<void>
  onDeleteSshServer?: (serverId: string) => void | Promise<void>
}

export function ToolDetailsPanel({
  tool,
  pending = false,
  error,
  credentialPending = false,
  credentialStatus,
  sshKeys = [],
  sshServers = [],
  sshPending = false,
  onToggle,
  onSaveApiKey,
  onDeleteApiKey,
  onCreateSshKey,
  onDeleteSshKey,
  onCreateSshServer,
  onUpdateSshServer,
  onDeleteSshServer
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

      {tool.id.startsWith('ssh.') ? (
        <SshConfigurationSection
          sshKeys={sshKeys}
          sshServers={sshServers}
          pending={sshPending}
          {...(onCreateSshKey ? { onCreateSshKey } : {})}
          {...(onDeleteSshKey ? { onDeleteSshKey } : {})}
          {...(onCreateSshServer ? { onCreateSshServer } : {})}
          {...(onUpdateSshServer ? { onUpdateSshServer } : {})}
          {...(onDeleteSshServer ? { onDeleteSshServer } : {})}
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

function SshConfigurationSection(props: {
  sshKeys: SshKeyDto[]
  sshServers: SshServerDto[]
  pending: boolean
  onCreateSshKey?: (input: CreateSshKeyInput) => void | Promise<void>
  onDeleteSshKey?: (keyId: string) => void | Promise<void>
  onCreateSshServer?: (input: CreateSshServerInput) => void | Promise<void>
  onUpdateSshServer?: (input: UpdateSshServerInput) => void | Promise<void>
  onDeleteSshServer?: (serverId: string) => void | Promise<void>
}) {
  const { sshKeys, sshServers, pending, onCreateSshKey, onDeleteSshKey, onCreateSshServer, onDeleteSshServer } = props
  const [keyName, setKeyName] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [keyNote, setKeyNote] = useState('')
  const [serverName, setServerName] = useState('')
  const [serverHost, setServerHost] = useState('')
  const [serverPort, setServerPort] = useState('22')
  const [serverUsername, setServerUsername] = useState('')
  const [serverKeyId, setServerKeyId] = useState('')
  const [serverNote, setServerNote] = useState('')
  const keyNameById = new Map(sshKeys.map((key) => [key.id, key.name]))

  const submitKey = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = keyName.trim()
    const privateKeyValue = privateKey.trim()
    if (!name || !privateKeyValue || pending) return
    const passphraseValue = passphrase.trim()
    const noteValue = keyNote.trim()
    const input: CreateSshKeyInput = {
      name,
      privateKey: privateKeyValue,
      ...(passphraseValue ? { passphrase: passphraseValue } : {}),
      ...(noteValue ? { note: noteValue } : {})
    }
    void onCreateSshKey?.(input)
    setKeyName('')
    setPrivateKey('')
    setPassphrase('')
    setKeyNote('')
  }

  const submitServer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const name = serverName.trim()
    const host = serverHost.trim()
    const username = serverUsername.trim()
    const keyId = serverKeyId || sshKeys[0]?.id
    const port = Number(serverPort)
    if (!name || !host || !username || !keyId || !Number.isInteger(port) || port < 1 || port > 65535 || pending) return
    const noteValue = serverNote.trim()
    const input: CreateSshServerInput = {
      name,
      host,
      port,
      username,
      keyId,
      ...(noteValue ? { note: noteValue } : {})
    }
    void onCreateSshServer?.(input)
    setServerName('')
    setServerHost('')
    setServerPort('22')
    setServerUsername('')
    setServerKeyId('')
    setServerNote('')
  }

  const keySubmitDisabled = pending || !onCreateSshKey || !keyName.trim() || !privateKey.trim()
  const serverSubmitDisabled = pending || !onCreateSshServer || !serverName.trim() || !serverHost.trim() || !serverUsername.trim() || !(serverKeyId || sshKeys[0]?.id)

  return (
    <section aria-label="SSH 配置" style={sshPanelStyle}>
      <div style={{ display: 'grid', gap: 8 }}>
        <h3 style={sectionTitleStyle}>SSH 配置</h3>
        <p style={mutedTextStyle}>在本地保存 SSH 私钥元数据和服务器连接信息，供 ssh.* 工具执行命令时选择。</p>
        <p style={mutedTextStyle}>编辑服务器可通过删除后重新添加完成。</p>
      </div>

      <div style={sshTwoColumnStyle}>
        <form onSubmit={submitKey} style={sshCardStyle}>
          <h4 style={sshCardTitleStyle}>SSH 密钥</h4>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 密钥名称</span>
            <input value={keyName} disabled={pending} onChange={(event) => setKeyName(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 私钥内容</span>
            <textarea value={privateKey} disabled={pending} onChange={(event) => setPrivateKey(event.target.value)} style={sshTextareaStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH Passphrase</span>
            <input type="password" value={passphrase} disabled={pending} onChange={(event) => setPassphrase(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 密钥备注</span>
            <input value={keyNote} disabled={pending} onChange={(event) => setKeyNote(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <button type="submit" disabled={keySubmitDisabled} style={primaryButtonStyle(keySubmitDisabled)}>保存 SSH 密钥</button>
        </form>

        <form onSubmit={submitServer} style={sshCardStyle}>
          <h4 style={sshCardTitleStyle}>SSH 服务器</h4>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 服务器名称</span>
            <input value={serverName} disabled={pending} onChange={(event) => setServerName(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH Host 或 IP</span>
            <input value={serverHost} disabled={pending} onChange={(event) => setServerHost(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 端口</span>
            <input type="number" min={1} max={65535} value={serverPort} disabled={pending} onChange={(event) => setServerPort(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 用户名</span>
            <input value={serverUsername} disabled={pending} onChange={(event) => setServerUsername(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 密钥</span>
            <select value={serverKeyId} disabled={pending || sshKeys.length === 0} onChange={(event) => setServerKeyId(event.target.value)} style={apiKeyInputStyle}>
              <option value="">选择 SSH 密钥</option>
              {sshKeys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}
            </select>
          </label>
          <label style={apiKeyInputLabelStyle}>
            <span>SSH 服务器备注</span>
            <input value={serverNote} disabled={pending} onChange={(event) => setServerNote(event.target.value)} style={apiKeyInputStyle} />
          </label>
          <button type="submit" disabled={serverSubmitDisabled} style={primaryButtonStyle(serverSubmitDisabled)}>保存 SSH 服务器</button>
        </form>
      </div>

      <div style={sshListGridStyle}>
        <div style={sshListSectionStyle}>
          <h4 style={sshCardTitleStyle}>已保存密钥</h4>
          {sshKeys.length > 0 ? (
            <ul style={sshListStyle}>
              {sshKeys.map((key) => (
                <li key={key.id} style={sshListItemStyle}>
                  <div style={sshListTextStyle}>
                    <strong>{key.name}</strong>
                    <span>{key.note || '无备注'}</span>
                    <span style={sshBadgeStyle(key.hasPassphrase)}>{key.hasPassphrase ? 'Passphrase' : '无 Passphrase'}</span>
                  </div>
                  <button type="button" aria-label={`删除 SSH 密钥 ${key.name}`} disabled={pending || !onDeleteSshKey} onClick={() => { void onDeleteSshKey?.(key.id) }} style={secondaryButtonStyle(pending || !onDeleteSshKey)}>删除</button>
                </li>
              ))}
            </ul>
          ) : <p style={mutedTextStyle}>暂无 SSH 密钥</p>}
        </div>

        <div style={sshListSectionStyle}>
          <h4 style={sshCardTitleStyle}>已保存服务器</h4>
          {sshServers.length > 0 ? (
            <ul style={sshListStyle}>
              {sshServers.map((server) => (
                <li key={server.id} style={sshListItemStyle}>
                  <div style={sshListTextStyle}>
                    <strong>{server.name}</strong>
                    <span>{server.host}:{server.port}</span>
                    <span>{server.username}</span>
                    <span>密钥：{keyNameById.get(server.keyId) ?? server.keyId}</span>
                    <span>{server.note || '无备注'}</span>
                  </div>
                  <button type="button" aria-label={`删除 SSH 服务器 ${server.name}`} disabled={pending || !onDeleteSshServer} onClick={() => { void onDeleteSshServer?.(server.id) }} style={secondaryButtonStyle(pending || !onDeleteSshServer)}>删除</button>
                </li>
              ))}
            </ul>
          ) : <p style={mutedTextStyle}>暂无 SSH 服务器</p>}
        </div>
      </div>
    </section>
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

const sshPanelStyle: CSSProperties = {
  ...apiKeySectionStyle,
  gap: 18
}

const sshTwoColumnStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 14
}

const sshCardStyle: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 14,
  borderRadius: 14,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'var(--hesper-color-surface, #1f2335)'
}

const sshCardTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  fontWeight: 900
}

const sshTextareaStyle: CSSProperties = {
  minHeight: 96,
  borderRadius: 10,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'var(--hesper-color-surface, #1f2335)',
  color: 'var(--hesper-color-text, #c0caf5)',
  padding: 10,
  outline: 'none',
  resize: 'vertical',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  lineHeight: 1.45
}

const sshListGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: 14
}

const sshListSectionStyle: CSSProperties = {
  display: 'grid',
  gap: 10
}

const sshListStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 10
}

const sshListItemStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'start',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid var(--hesper-color-border, #414868)',
  background: 'rgba(0, 0, 0, 0.14)'
}

const sshListTextStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 5,
  color: 'var(--hesper-color-text-muted, #9aa5ce)',
  overflowWrap: 'anywhere'
}

function sshBadgeStyle(active: boolean): CSSProperties {
  return {
    justifySelf: 'start',
    borderRadius: 999,
    padding: '3px 8px',
    fontSize: 11,
    fontWeight: 800,
    color: active ? 'var(--hesper-color-success, #9ece6a)' : 'var(--hesper-color-text-muted, #737aa2)',
    background: active ? 'rgba(158, 206, 106, 0.14)' : 'rgba(148, 163, 184, 0.12)'
  }
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
