import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { CreateSshKeyInput, CreateSshServerInput, SshKeyDto, SshServerDto } from '../../electron/ipc-contract'

type SshSettingsPanelProps = {
  keys: SshKeyDto[]
  servers: SshServerDto[]
  pending?: boolean
  error?: string
  onCreateKey?: (input: CreateSshKeyInput) => void | Promise<void>
  onDeleteKey?: (id: string) => void | Promise<void>
  onCreateServer?: (input: CreateSshServerInput) => void | Promise<void>
  onDeleteServer?: (id: string) => void | Promise<void>
}

type ActiveDialog = 'key' | 'server'

export function SshSettingsPanel({
  keys,
  servers,
  pending = false,
  error,
  onCreateKey,
  onDeleteKey,
  onCreateServer,
  onDeleteServer
}: SshSettingsPanelProps) {
  const [activeDialog, setActiveDialog] = useState<ActiveDialog>()
  const keyNameById = new Map(keys.map((key) => [key.id, key.name]))

  return (
    <section aria-label="SSH 设置面板" style={settingsPanelStyle}>
      <header style={settingsHeaderStyle}>
        <h2 style={settingsTitleStyle}>SSH</h2>
        <p style={settingsDescriptionStyle}>管理本地 SSH 密钥与主机。私钥仅保存到本地凭据库，列表中不会显示私钥或完整连接信息。</p>
      </header>

      <div style={feedbackRowStyle}>
        {error ? <p role="alert" style={errorTextStyle}>{error}</p> : null}
      </div>

      <div className="hesper-scroll-invisible" style={scrollContentStyle}>
        <section aria-label="SSH 密钥管理" style={sectionBlockStyle}>
          <div style={sectionHeaderRowStyle}>
            <div>
              <h3 style={sectionTitleStyle}>SSH 密钥管理</h3>
              <p style={sectionDescriptionStyle}>保存密钥名称和公钥摘要；私钥不会在界面中回显。</p>
            </div>
            <button type="button" disabled={pending || !onCreateKey} onClick={() => setActiveDialog('key')} style={secondaryActionStyle(pending || !onCreateKey)}>添加 SSH 密钥</button>
          </div>
          <div style={listStyle}>
            {keys.length > 0 ? keys.map((key, index) => (
              <RowShell key={key.id} showSeparator={index > 0}>
                <div style={itemInfoStyle}>
                  <span style={avatarStyle}>K</span>
                  <span style={itemTextStyle}>
                    <strong>{key.name}</strong>
                    <span style={metaTextStyle}>{maskPublicKey(key.publicKey)} · {key.hasPassphrase ? '已设置 Passphrase' : '无 Passphrase'}</span>
                    {key.note ? <span style={noteTextStyle}>{key.note}</span> : null}
                  </span>
                </div>
                <button type="button" aria-label={`删除 SSH 密钥 ${key.name}`} disabled={pending || !onDeleteKey} onClick={() => { void onDeleteKey?.(key.id) }} style={menuButtonStyle(pending || !onDeleteKey)}>删除</button>
              </RowShell>
            )) : <EmptyState text="暂无 SSH 密钥" />}
          </div>
        </section>

        <section aria-label="SSH 主机管理" style={sectionBlockStyle}>
          <div style={sectionHeaderRowStyle}>
            <div>
              <h3 style={sectionTitleStyle}>SSH 主机管理</h3>
              <p style={sectionDescriptionStyle}>主机 IP 默认打码显示；主机使用的密钥从上方密钥列表中选择。</p>
            </div>
            <button type="button" disabled={pending || !onCreateServer || keys.length === 0} onClick={() => setActiveDialog('server')} style={secondaryActionStyle(pending || !onCreateServer || keys.length === 0)}>添加 SSH 主机</button>
          </div>
          <div style={listStyle}>
            {servers.length > 0 ? servers.map((server, index) => (
              <RowShell key={server.id} showSeparator={index > 0}>
                <div style={itemInfoStyle}>
                  <span style={avatarStyle}>H</span>
                  <span style={itemTextStyle}>
                    <strong>{server.name}</strong>
                    <span style={metaTextStyle}>{maskHost(server.host)}:{server.port} · 用户 {maskUsername(server.username)} · 密钥 {keyNameById.get(server.keyId) ?? '未知密钥'}</span>
                    {server.note ? <span style={noteTextStyle}>{server.note}</span> : null}
                  </span>
                </div>
                <button type="button" aria-label={`删除 SSH 主机 ${server.name}`} disabled={pending || !onDeleteServer} onClick={() => { void onDeleteServer?.(server.id) }} style={menuButtonStyle(pending || !onDeleteServer)}>删除</button>
              </RowShell>
            )) : <EmptyState text={keys.length === 0 ? '添加密钥后即可添加 SSH 主机' : '暂无 SSH 主机'} />}
          </div>
        </section>
      </div>

      {activeDialog === 'key' ? (
        <SshKeyDialog
          pending={pending}
          onCancel={() => setActiveDialog(undefined)}
          onSave={async (input) => {
            await onCreateKey?.(input)
            setActiveDialog(undefined)
          }}
        />
      ) : null}

      {activeDialog === 'server' ? (
        <SshServerDialog
          keys={keys}
          pending={pending}
          onCancel={() => setActiveDialog(undefined)}
          onSave={async (input) => {
            await onCreateServer?.(input)
            setActiveDialog(undefined)
          }}
        />
      ) : null}
    </section>
  )
}

function RowShell({ showSeparator, children }: { showSeparator: boolean; children: ReactNode }) {
  return (
    <>
      {showSeparator ? <div aria-hidden="true" style={separatorStyle} /> : null}
      <div style={itemStyle}>{children}</div>
    </>
  )
}

function EmptyState({ text }: { text: string }) {
  return <div style={emptyStateStyle}>{text}</div>
}

function SshKeyDialog({ pending, onCancel, onSave }: {
  pending: boolean
  onCancel: () => void
  onSave: (input: CreateSshKeyInput) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const disabled = pending || !name.trim() || !publicKey.trim() || !privateKey.trim()

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    const input = {
      name: name.trim(),
      publicKey: publicKey.trim(),
      privateKey: privateKey.trim()
    }
    setPrivateKey('')
    await onSave(input)
  }

  return (
    <FullWindowDialogShell ariaLabel="添加 SSH 密钥" onClose={onCancel} initialFocusRef={nameInputRef}>
      <form onSubmit={(event) => { void submit(event) }} style={overlayFormStyle}>
        <DialogHeader title="添加 SSH 密钥" description="填写密钥名称、公钥和私钥。私钥保存后会立即清空，之后不会在界面中显示。" />
        <label style={fieldStyle}>
          SSH 密钥名称
          <input ref={nameInputRef} aria-label="SSH 密钥名称" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} placeholder="例如 Production key" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          SSH 公钥内容
          <textarea aria-label="SSH 公钥内容" value={publicKey} disabled={pending} onChange={(event) => setPublicKey(event.target.value)} placeholder="ssh-ed25519 AAAA... user@example" style={textareaStyle} />
        </label>
        <label style={fieldStyle}>
          SSH 私钥内容
          <textarea aria-label="SSH 私钥内容" value={privateKey} disabled={pending} onChange={(event) => setPrivateKey(event.target.value)} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" style={{ ...textareaStyle, minHeight: 160 }} />
        </label>
        <footer style={dialogFooterStyle}>
          <button type="button" onClick={onCancel} style={secondaryActionStyle(false)}>取消</button>
          <button type="submit" disabled={disabled} style={primaryActionStyle(disabled)}>保存 SSH 密钥</button>
        </footer>
      </form>
    </FullWindowDialogShell>
  )
}

function SshServerDialog({ keys, pending, onCancel, onSave }: {
  keys: SshKeyDto[]
  pending: boolean
  onCancel: () => void
  onSave: (input: CreateSshServerInput) => Promise<void> | void
}) {
  const [name, setName] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('22')
  const [username, setUsername] = useState('')
  const [keyId, setKeyId] = useState(keys[0]?.id ?? '')
  const [note, setNote] = useState('')
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  const parsedPort = Number(port)
  const disabled = pending || !name.trim() || !host.trim() || !username.trim() || !keyId || !Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (disabled) return
    await onSave({
      name: name.trim(),
      host: host.trim(),
      port: parsedPort,
      username: username.trim(),
      keyId,
      ...(note.trim() ? { note: note.trim() } : {})
    })
  }

  return (
    <FullWindowDialogShell ariaLabel="添加 SSH 主机" onClose={onCancel} initialFocusRef={nameInputRef}>
      <form onSubmit={(event) => { void submit(event) }} style={overlayFormStyle}>
        <DialogHeader title="添加 SSH 主机" description="填写主机连接信息，并选择这台主机使用的 SSH 密钥。列表中会默认打码显示 IP 和用户名。" />
        <label style={fieldStyle}>
          SSH 主机名称
          <input ref={nameInputRef} aria-label="SSH 主机名称" value={name} disabled={pending} onChange={(event) => setName(event.target.value)} placeholder="例如 Production host" style={inputStyle} />
        </label>
        <label style={fieldStyle}>
          主机 IP 地址
          <input aria-label="主机 IP 地址" value={host} disabled={pending} onChange={(event) => setHost(event.target.value)} placeholder="10.0.0.8 或 host.example.com" style={inputStyle} />
        </label>
        <div style={twoColumnFieldStyle}>
          <label style={fieldStyle}>
            SSH 端口
            <input aria-label="SSH 端口" type="number" min={1} max={65535} value={port} disabled={pending} onChange={(event) => setPort(event.target.value)} style={inputStyle} />
          </label>
          <label style={fieldStyle}>
            SSH 用户名
            <input aria-label="SSH 用户名" value={username} disabled={pending} onChange={(event) => setUsername(event.target.value)} placeholder="deploy" style={inputStyle} />
          </label>
        </div>
        <label style={fieldStyle}>
          SSH 密钥
          <select aria-label="SSH 密钥" value={keyId} disabled={pending || keys.length === 0} onChange={(event) => setKeyId(event.target.value)} style={inputStyle}>
            <option value="">选择 SSH 密钥</option>
            {keys.map((key) => <option key={key.id} value={key.id}>{key.name}</option>)}
          </select>
        </label>
        <label style={fieldStyle}>
          主机备注
          <input aria-label="主机备注" value={note} disabled={pending} onChange={(event) => setNote(event.target.value)} placeholder="例如 logs / staging" style={inputStyle} />
        </label>
        <footer style={dialogFooterStyle}>
          <button type="button" onClick={onCancel} style={secondaryActionStyle(false)}>取消</button>
          <button type="submit" disabled={disabled} style={primaryActionStyle(disabled)}>保存 SSH 主机</button>
        </footer>
      </form>
    </FullWindowDialogShell>
  )
}

function DialogHeader({ title, description }: { title: string; description: string }) {
  return (
    <header style={dialogHeaderStyle}>
      <h2 style={dialogTitleStyle}>{title}</h2>
      <p style={dialogDescriptionStyle}>{description}</p>
    </header>
  )
}

const dialogFocusableSelector = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

function getFocusableDialogElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(dialogFocusableSelector)).filter((element) => element.tabIndex >= 0)
}

function FullWindowDialogShell({ ariaLabel, children, onClose, initialFocusRef }: {
  ariaLabel: string
  children: ReactNode
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const focusTarget = initialFocusRef?.current ?? dialogRef.current
    focusTarget?.focus()
  }, [initialFocusRef])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const focusableElements = getFocusableDialogElements(dialog)
    if (focusableElements.length === 0) {
      event.preventDefault()
      dialog.focus()
      return
    }
    const first = focusableElements[0]!
    const last = focusableElements[focusableElements.length - 1]!
    const active = document.activeElement
    const outside = !active || !dialog.contains(active)
    if (event.shiftKey) {
      if (active === first || active === dialog || outside) {
        event.preventDefault()
        last.focus()
      }
      return
    }
    if (active === last || active === dialog || outside) {
      event.preventDefault()
      first.focus()
    }
  }

  return createPortal(
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={ariaLabel} tabIndex={-1} onKeyDown={handleKeyDown} style={fullWindowOverlayStyle}>
      <button type="button" aria-label={`关闭 ${ariaLabel}`} onClick={onClose} style={overlayCloseStyle}>×</button>
      {children}
    </div>,
    document.body
  )
}

function maskPublicKey(publicKey?: string): string {
  const trimmed = publicKey?.trim()
  if (!trimmed) return '未保存公钥'
  const [kind, body] = trimmed.split(/\s+/, 2)
  if (!kind || !body) return trimmed.length > 22 ? `${trimmed.slice(0, 14)}…${trimmed.slice(-6)}` : trimmed
  return `${kind} ${body.length > 18 ? `${body.slice(0, 10)}…${body.slice(-6)}` : body}`
}

function maskHost(host: string): string {
  const trimmed = host.trim()
  const ipv4 = trimmed.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (ipv4) return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.***`
  const parts = trimmed.split('.')
  if (parts.length > 1) return `${parts[0]?.slice(0, 2) || '*'}***.${parts.slice(1).join('.')}`
  return trimmed.length > 4 ? `${trimmed.slice(0, 2)}***` : '已设置'
}

function maskUsername(username: string): string {
  const trimmed = username.trim()
  if (trimmed.length <= 2) return '已设置'
  return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`
}

const mutedTextColor = 'var(--hesper-color-text-muted, #737aa2)'
const bodyTextColor = 'var(--hesper-color-text, #c0caf5)'
const surfaceColor = 'var(--hesper-color-surface, #16161e)'
const surfaceMutedColor = 'var(--hesper-color-surface-muted, #24283b)'
const borderColor = 'var(--hesper-color-border, #414868)'
const accentColor = 'var(--hesper-color-accent, #7aa2f7)'
const dangerTextColor = 'var(--hesper-color-danger, #f7768e)'
const softControlColor = 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))'
const bodyFontSize = 'var(--hesper-font-size, 14px)'

const settingsPanelStyle: CSSProperties = {
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'auto auto minmax(0, 1fr)',
  gap: 14,
  overflow: 'hidden',
  fontSize: bodyFontSize,
  color: bodyTextColor
}

const settingsHeaderStyle: CSSProperties = {
  display: 'grid',
  gap: 6,
  justifyItems: 'center',
  textAlign: 'center'
}

const settingsTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: bodyFontSize,
  lineHeight: '24px',
  fontWeight: 700
}

const settingsDescriptionStyle: CSSProperties = {
  maxWidth: 640,
  margin: 0,
  color: mutedTextColor,
  lineHeight: 1.5
}

const feedbackRowStyle: CSSProperties = {
  minHeight: 20,
  display: 'grid',
  alignContent: 'center'
}

const scrollContentStyle: CSSProperties = {
  minHeight: 0,
  overflow: 'auto',
  display: 'grid',
  alignContent: 'start',
  gap: 24,
  paddingRight: 2
}

const sectionBlockStyle: CSSProperties = {
  display: 'grid',
  gap: 12
}

const sectionHeaderRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'end',
  gap: 14
}

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: bodyFontSize,
  lineHeight: 1.2
}

const sectionDescriptionStyle: CSSProperties = {
  margin: '4px 0 0',
  color: mutedTextColor,
  lineHeight: 1.45
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 0,
  borderRadius: 16,
  background: surfaceMutedColor,
  overflow: 'hidden'
}

const itemStyle: CSSProperties = {
  minHeight: 68,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto',
  alignItems: 'center',
  gap: 8,
  padding: '12px 14px'
}

const separatorStyle: CSSProperties = {
  height: 1,
  margin: '0 14px',
  background: 'var(--hesper-color-border-subtle, rgba(65, 72, 104, 0.45))'
}

const itemInfoStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gridTemplateColumns: '28px minmax(0, 1fr)',
  alignItems: 'center',
  gap: 12
}

const avatarStyle: CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 999,
  background: softControlColor,
  color: accentColor,
  display: 'grid',
  placeItems: 'center',
  fontSize: bodyFontSize,
  fontWeight: 700
}

const itemTextStyle: CSSProperties = {
  minWidth: 0,
  display: 'grid',
  gap: 3
}

const metaTextStyle: CSSProperties = {
  color: mutedTextColor,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const noteTextStyle: CSSProperties = {
  color: mutedTextColor,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  opacity: 0.82
}

const emptyStateStyle: CSSProperties = {
  minHeight: 68,
  display: 'grid',
  placeItems: 'center',
  color: mutedTextColor
}

const errorTextStyle: CSSProperties = {
  margin: 0,
  padding: '10px 12px',
  borderRadius: 12,
  color: dangerTextColor,
  background: 'rgba(247, 118, 142, 0.12)'
}

function secondaryActionStyle(disabled: boolean): CSSProperties {
  return {
    borderRadius: 10,
    border: 0,
    outline: 0,
    background: softControlColor,
    color: bodyTextColor,
    padding: '8px 12px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
    fontWeight: 700
  }
}

function primaryActionStyle(disabled: boolean): CSSProperties {
  return {
    border: 0,
    outline: 0,
    borderRadius: 10,
    padding: '10px 18px',
    background: softControlColor,
    color: accentColor,
    fontWeight: 700,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1
  }
}

function menuButtonStyle(disabled: boolean): CSSProperties {
  return {
    border: 0,
    outline: 0,
    borderRadius: 10,
    background: 'transparent',
    color: disabled ? mutedTextColor : dangerTextColor,
    padding: '8px 10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1
  }
}

const fullWindowOverlayStyle: CSSProperties = {
  position: 'fixed',
  top: 36,
  left: 0,
  right: 0,
  bottom: 0,
  zIndex: 50,
  background: surfaceColor,
  display: 'grid',
  placeItems: 'center',
  padding: 24
}

const overlayCloseStyle: CSSProperties = {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 30,
  height: 30,
  border: 0,
  outline: 0,
  borderRadius: 10,
  background: softControlColor,
  color: mutedTextColor,
  cursor: 'pointer'
}

const overlayFormStyle: CSSProperties = {
  width: 'min(560px, 100%)',
  boxSizing: 'border-box',
  minWidth: 0,
  maxHeight: 'calc(100vh - 84px)',
  overflowY: 'auto',
  display: 'grid',
  gap: 18,
  borderRadius: 22,
  border: `1px solid ${borderColor}`,
  background: surfaceMutedColor,
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.32)',
  padding: 24
}

const dialogHeaderStyle: CSSProperties = {
  textAlign: 'center',
  marginBottom: 6
}

const dialogTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 'calc(var(--hesper-font-size, 14px) + 4px)',
  lineHeight: 1.25
}

const dialogDescriptionStyle: CSSProperties = {
  margin: '12px 0 0',
  color: mutedTextColor,
  lineHeight: 1.5
}

const fieldStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 7,
  color: bodyTextColor,
  fontSize: bodyFontSize,
  fontWeight: 700
}

const inputStyle: CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minWidth: 0,
  borderRadius: 10,
  border: 0,
  outline: 0,
  background: softControlColor,
  color: bodyTextColor,
  padding: '9px 11px',
  fontSize: bodyFontSize
}

const textareaStyle: CSSProperties = {
  ...inputStyle,
  minHeight: 96,
  resize: 'vertical',
  fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
  lineHeight: 1.45
}

const twoColumnFieldStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: 12
}

const dialogFooterStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  marginTop: 8
}
