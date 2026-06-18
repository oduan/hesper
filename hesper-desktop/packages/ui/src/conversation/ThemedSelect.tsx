import { useId, useMemo, useState, type CSSProperties, type FocusEvent } from 'react'
import { darkTheme } from '../theme'

export type ThemedSelectOption = {
  value: string
  label: string
}

export type ThemedSelectOptionGroup = {
  id: string
  label: string
  options: readonly ThemedSelectOption[]
}

export type ThemedSelectProps = {
  ariaLabel: string
  value: string
  options: readonly string[]
  optionGroups?: readonly ThemedSelectOptionGroup[]
  onChange?: (value: string) => void
  minWidth?: number
  maxWidth?: number
  menuPlacement?: 'top' | 'bottom'
}

export function ThemedSelect({
  ariaLabel,
  value,
  options,
  optionGroups,
  onChange,
  minWidth = 108,
  maxWidth = 240,
  menuPlacement = 'bottom'
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState<string>()
  const listboxId = useId()
  const groupedValues = useMemo(() => new Set((optionGroups ?? []).flatMap((group) => group.options.map((option) => option.value))), [optionGroups])
  const flatOptions = useMemo(() => options.filter((option) => !groupedValues.has(option)), [groupedValues, options])
  const labeledOptions = useMemo(
    () => [
      ...(optionGroups ?? []).flatMap((group) => group.options),
      ...flatOptions.map((option) => ({ value: option, label: option }))
    ],
    [flatOptions, optionGroups]
  )
  const selectedLabel = labeledOptions.find((option) => option.value === value)?.label ?? value
  const hasGroups = (optionGroups?.length ?? 0) > 0

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
      setExpandedGroupId(undefined)
    }
  }

  const handleSelect = (nextValue: string) => {
    onChange?.(nextValue)
    setOpen(false)
    setExpandedGroupId(undefined)
  }

  const handleOpenChange = () => {
    setOpen((current) => {
      const nextOpen = !current
      if (!nextOpen) {
        setExpandedGroupId(undefined)
      }
      return nextOpen
    })
  }

  return (
    <div style={{ ...selectWrapStyle, minWidth, maxWidth }} onBlur={handleBlur}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-label={ariaLabel}
        onClick={handleOpenChange}
        style={selectButtonStyle}
      >
        <span style={selectValueStyle}>{selectedLabel}</span>
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
          {hasGroups ? optionGroups?.map((group) => {
            const expanded = expandedGroupId === group.id
            return (
              <div key={group.id} role="group" aria-label={group.label} style={selectGroupStyle}>
                <button
                  type="button"
                  aria-label={`连接 ${group.label}`}
                  onMouseEnter={() => setExpandedGroupId(group.id)}
                  onFocus={() => setExpandedGroupId(group.id)}
                  style={selectGroupButtonStyle}
                >
                  <span style={selectValueStyle}>{group.label}</span>
                  <span aria-hidden="true" style={selectGroupArrowStyle}>‹</span>
                </button>
                {expanded ? (
                  <div role="group" aria-label={`${group.label} 模型`} style={selectGroupOptionsStyle}>
                    {group.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        aria-selected={option.value === value}
                        onClick={() => handleSelect(option.value)}
                        style={{
                          ...selectOptionStyle,
                          ...(option.value === value ? activeSelectOptionStyle : {})
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          }) : null}
          {flatOptions.map((option) => (
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
  fontSize: darkTheme.typography.body,
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
  minWidth: '100%',
  width: 'max-content',
  maxWidth: 280,
  display: 'grid',
  gap: 4,
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surfaceMuted,
  padding: 6,
  boxShadow: '0 18px 36px rgba(0, 0, 0, 0.28)'
}

const selectGroupStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 2
}

const selectGroupButtonStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.sm,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: darkTheme.spacing.sm,
  textAlign: 'left',
  cursor: 'default',
  fontSize: darkTheme.typography.body,
  overflow: 'hidden',
  whiteSpace: 'nowrap'
}

const selectGroupArrowStyle: CSSProperties = {
  flex: '0 0 auto',
  color: darkTheme.color.textMuted,
  fontSize: darkTheme.typography.body
}

const selectGroupOptionsStyle: CSSProperties = {
  position: 'absolute',
  right: 'calc(100% + 6px)',
  top: 0,
  zIndex: 31,
  minWidth: 'max-content',
  width: 'max-content',
  maxWidth: 280,
  display: 'grid',
  gap: 2,
  borderRadius: darkTheme.radius.md,
  background: darkTheme.color.surfaceMuted,
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
  fontSize: darkTheme.typography.body,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const activeSelectOptionStyle: CSSProperties = {
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))',
  color: darkTheme.color.text
}
