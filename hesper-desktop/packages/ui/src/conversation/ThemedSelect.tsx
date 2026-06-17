import { useId, useState, type CSSProperties, type FocusEvent } from 'react'
import { darkTheme } from '../theme'

export type ThemedSelectProps = {
  ariaLabel: string
  value: string
  options: readonly string[]
  onChange?: (value: string) => void
  minWidth?: number
  maxWidth?: number
  menuPlacement?: 'top' | 'bottom'
}

export function ThemedSelect({
  ariaLabel,
  value,
  options,
  onChange,
  minWidth = 108,
  maxWidth = 240,
  menuPlacement = 'bottom'
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const listboxId = useId()

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
    }
  }

  const handleSelect = (nextValue: string) => {
    onChange?.(nextValue)
    setOpen(false)
  }

  return (
    <div style={{ ...selectWrapStyle, minWidth, maxWidth }} onBlur={handleBlur}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={() => setOpen((value) => !value)}
        style={selectButtonStyle}
      >
        <span style={selectValueStyle}>{value}</span>
        <svg aria-hidden="true" viewBox="0 0 16 16" style={selectArrowStyle}>
          <path d="M4 6.25 8 10.25 12 6.25" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          aria-label={`${ariaLabel}选项`}
          style={{
            ...selectMenuStyle,
            ...(menuPlacement === 'top' ? { bottom: 'calc(100% + 6px)' } : { top: 'calc(100% + 6px)' })
          }}
        >
          {options.map((option) => (
            <button
              key={option}
              type="button"
              role="option"
              aria-selected={option === value}
              onClick={() => handleSelect(option)}
              style={{
                ...selectOptionStyle,
                ...(option === value ? activeSelectOptionStyle : {})
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const selectWrapStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-block'
}

const selectButtonStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: darkTheme.spacing.xs,
  cursor: 'pointer',
  fontSize: 12,
  lineHeight: 1.2,
  textAlign: 'left'
}

const selectValueStyle: CSSProperties = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const selectArrowStyle: CSSProperties = {
  width: 16,
  height: 16,
  color: darkTheme.color.textMuted,
  display: 'block',
  flex: '0 0 auto'
}

const selectMenuStyle: CSSProperties = {
  position: 'absolute',
  zIndex: 30,
  left: 0,
  right: 0,
  display: 'grid',
  gap: 4,
  borderRadius: darkTheme.radius.md,
  background: '#202434',
  padding: 6,
  boxShadow: '0 18px 36px rgba(0, 0, 0, 0.28)'
}

const selectOptionStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.sm,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  display: 'block',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: 12,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const activeSelectOptionStyle: CSSProperties = {
  background: 'rgba(255, 255, 255, 0.06)',
  color: '#eef2ff'
}
