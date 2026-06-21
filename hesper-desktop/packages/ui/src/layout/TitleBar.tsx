import type { CSSProperties } from 'react'
import { themeTokens } from '../theme'

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
        background: themeTokens.color.background,
        color: themeTokens.color.text,
        userSelect: 'none'
      }}
    >
      {isMac ? <div className="titlebar-no-drag" style={macControlsSlotStyle}>{controls}</div> : null}
      <div style={brandStyle}>Hesper</div>
      <div style={{ fontSize: themeTokens.typography.body, fontWeight: 700, letterSpacing: '0.02em', pointerEvents: 'none' }}>{title}</div>
      {!isMac ? <div className="titlebar-no-drag" style={windowsControlsSlotStyle}>{controls}</div> : null}
    </header>
  )
}

function WindowControls({ platform, onMinimize, onToggleMaximize, onClose }: WindowControlsProps) {
  if (isMacPlatform(platform)) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* macOS traffic light colors intentionally match native window controls. */}
        <button type="button" aria-label="关闭窗口" onClick={() => { void onClose?.() }} style={{ ...macControlStyle, background: '#ff5f57' }} />
        <button type="button" aria-label="最小化窗口" onClick={() => { void onMinimize?.() }} style={{ ...macControlStyle, background: '#ffbd2e' }} />
        <button type="button" aria-label="最大化窗口" onClick={() => { void onToggleMaximize?.() }} style={{ ...macControlStyle, background: '#28c840' }} />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <button type="button" aria-label="最小化窗口" onClick={() => { void onMinimize?.() }} style={windowsControlStyle}>
        <MinimizeIcon />
      </button>
      <button type="button" aria-label="最大化窗口" onClick={() => { void onToggleMaximize?.() }} style={windowsControlStyle}>
        <MaximizeIcon />
      </button>
      <button type="button" aria-label="关闭窗口" onClick={() => { void onClose?.() }} style={windowsControlStyle}>
        <CloseIcon />
      </button>
    </div>
  )
}

function MinimizeIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M3.25 7h7.5" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="3.5" y="3.5" width="7" height="7" rx="0.8" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <path d="M4 4l6 6M10 4l-6 6" />
    </svg>
  )
}

const brandStyle: CSSProperties = {
  position: 'absolute',
  left: 16,
  top: 0,
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  fontSize: themeTokens.typography.body,
  fontWeight: 700,
  letterSpacing: '0.02em',
  color: themeTokens.color.text,
  pointerEvents: 'none'
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
  color: themeTokens.color.textMuted,
  cursor: 'pointer',
  lineHeight: 1,
  outline: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
}

const macControlStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 999,
  border: `1px solid ${themeTokens.color.borderSubtle}`,
  padding: 0,
  cursor: 'pointer',
  outline: 0
}
