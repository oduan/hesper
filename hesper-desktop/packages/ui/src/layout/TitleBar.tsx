import type { CSSProperties } from 'react'
import { darkTheme } from '../theme'

export type DesktopPlatform = 'aix' | 'android' | 'darwin' | 'freebsd' | 'haiku' | 'linux' | 'openbsd' | 'sunos' | 'win32' | 'cygwin' | 'netbsd'
export type WindowControlAction = () => unknown | Promise<unknown>

export type TitleBarProps = {
  title: string
  platform?: DesktopPlatform
  onMinimize?: WindowControlAction
  onToggleMaximize?: WindowControlAction
  onClose?: WindowControlAction
}

type WindowControlsProps = Omit<TitleBarProps, 'title'>

function isMacPlatform(platform: DesktopPlatform | undefined): boolean {
  return platform === 'darwin'
}

export function TitleBar({ title, platform = 'win32', onMinimize, onToggleMaximize, onClose }: TitleBarProps) {
  const isMac = isMacPlatform(platform)
  const controls = (
    <WindowControls
      platform={platform}
      {...(onMinimize ? { onMinimize } : {})}
      {...(onToggleMaximize ? { onToggleMaximize } : {})}
      {...(onClose ? { onClose } : {})}
    />
  )

  return (
    <header
      className="titlebar-drag"
      aria-label="窗口标题栏"
      style={{
        position: 'relative',
        height: 36,
        minHeight: 36,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderBottom: 0,
        background: darkTheme.color.background,
        color: darkTheme.color.text,
        userSelect: 'none'
      }}
    >
      {isMac ? <div className="titlebar-no-drag" style={macControlsSlotStyle}>{controls}</div> : null}
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.02em', pointerEvents: 'none' }}>{title}</div>
      {!isMac ? <div className="titlebar-no-drag" style={windowsControlsSlotStyle}>{controls}</div> : null}
    </header>
  )
}

function WindowControls({ platform, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  if (isMacPlatform(platform)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" aria-label="关闭窗口" onClick={() => { void onClose?.() }} style={{ ...macControlStyle, background: '#ff5f57' }} />
        <button type="button" aria-label="最小化窗口" onClick={() => { void onMinimize?.() }} style={{ ...macControlStyle, background: '#ffbd2e' }} />
        <button type="button" aria-label="最大化窗口" onClick={() => { void onToggleMaximize?.() }} style={{ ...macControlStyle, background: '#28c840' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <button type="button" aria-label="最小化窗口" onClick={() => { void onMinimize?.() }} style={windowsControlStyle}>—</button>
      <button type="button" aria-label="最大化窗口" onClick={() => { void onToggleMaximize?.() }} style={windowsControlStyle}>□</button>
      <button type="button" aria-label="关闭窗口" onClick={() => { void onClose?.() }} style={{ ...windowsControlStyle, ...windowsCloseStyle }}>×</button>
    </div>
  )
}

const windowsControlsSlotStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  top: 0,
  height: '100%'
}

const macControlsSlotStyle: CSSProperties = {
  position: 'absolute',
  left: 12,
  top: 0,
  height: '100%',
  display: 'flex',
  alignItems: 'center'
}

const windowsControlStyle: CSSProperties = {
  width: 46,
  height: '100%',
  border: 0,
  borderRadius: 0,
  background: 'transparent',
  color: darkTheme.color.textMuted,
  cursor: 'pointer',
  fontSize: 13,
  lineHeight: 1,
  outline: 0
}

const windowsCloseStyle: CSSProperties = {
  color: '#f3f4f6'
}

const macControlStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 999,
  border: '1px solid rgba(0, 0, 0, 0.16)',
  padding: 0,
  cursor: 'pointer',
  outline: 0
}
