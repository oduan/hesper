import { useId, useMemo, useState, type CSSProperties, type FocusEvent } from 'react'
import { themeTokens } from '../theme'

export type ThemedSelectOption = {
  value: string
  label: string
}

export type ThemedSelectOptionGroup = {
  id: string
  label: string
  options: readonly ThemedSelectOption[]
}

export type ThemedSelectAuxiliaryMenu = {
  label: string
  ariaLabel: string
  value: string
  valueLabel?: string
  options: readonly ThemedSelectOption[]
  onChange: (value: string) => void
}

export type ThemedSelectProps = {
  ariaLabel: string
  value: string
  options: readonly string[]
  optionGroups?: readonly ThemedSelectOptionGroup[]
  auxiliaryMenu?: ThemedSelectAuxiliaryMenu
  onChange?: (value: string) => void
  emptyLabel?: string
  minWidth?: number
  maxWidth?: number
  menuPlacement?: 'top' | 'bottom'
}

export function ThemedSelect({
  ariaLabel,
  value,
  options,
  optionGroups,
  auxiliaryMenu,
  onChange,
  emptyLabel,
  minWidth = 108,
  maxWidth = 240,
  menuPlacement = 'bottom'
}: ThemedSelectProps) {
  const [open, setOpen] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState<string>()
  const [auxiliaryMenuExpanded, setAuxiliaryMenuExpanded] = useState(false)
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
  const fallbackSelectedLabel = value.trim() || emptyLabel || value
  const selectedLabel = labeledOptions.find((option) => option.value === value)?.label ?? fallbackSelectedLabel
  const auxiliarySelectedLabel = auxiliaryMenu?.valueLabel ?? auxiliaryMenu?.options.find((option) => option.value === auxiliaryMenu.value)?.label ?? auxiliaryMenu?.value
  const hasGroups = (optionGroups?.length ?? 0) > 0

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setOpen(false)
      setExpandedGroupId(undefined)
      setAuxiliaryMenuExpanded(false)
    }
  }

  const closeMenu = () => {
    setOpen(false)
    setExpandedGroupId(undefined)
    setAuxiliaryMenuExpanded(false)
  }

  const handleSelect = (nextValue: string) => {
    onChange?.(nextValue)
    closeMenu()
  }

  const handleAuxiliarySelect = (nextValue: string) => {
    auxiliaryMenu?.onChange(nextValue)
    closeMenu()
  }

  const handleOpenChange = () => {
    setOpen((current) => {
      const nextOpen = !current
      if (!nextOpen) {
        setExpandedGroupId(undefined)
        setAuxiliaryMenuExpanded(false)
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
          <style>{themedSelectHoverCss}</style>
          {hasGroups ? optionGroups?.map((group) => {
            const expanded = expandedGroupId === group.id
            return (
              <div key={group.id} role="group" aria-label={group.label} style={selectGroupStyle}>
                <button
                  type="button"
                  className="hesper-themed-select-group-button"
                  aria-label={`连接 ${group.label}`}
                  onMouseEnter={() => {
                    setExpandedGroupId(group.id)
                    setAuxiliaryMenuExpanded(false)
                  }}
                  onFocus={() => {
                    setExpandedGroupId(group.id)
                    setAuxiliaryMenuExpanded(false)
                  }}
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
                        className="hesper-themed-select-option"
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
              className="hesper-themed-select-option"
              aria-selected={option === value}
              onMouseEnter={() => setAuxiliaryMenuExpanded(false)}
              onFocus={() => setAuxiliaryMenuExpanded(false)}
              onClick={() => handleSelect(option)}
              style={{
                ...selectOptionStyle,
                ...(option === value ? activeSelectOptionStyle : {})
              }}
            >
              {option}
            </button>
          ))}
          {auxiliaryMenu ? (
            <>
              <div role="separator" aria-label={`${ariaLabel.replace(/^选择/, '')}和${auxiliaryMenu.label}分割线`} style={selectMenuSeparatorStyle} />
              <div role="group" aria-label={auxiliaryMenu.label} style={selectGroupStyle}>
                <button
                  type="button"
                  className="hesper-themed-select-group-button"
                  aria-label={`${auxiliaryMenu.label}：${auxiliarySelectedLabel}`}
                  onMouseEnter={() => {
                    setExpandedGroupId(undefined)
                    setAuxiliaryMenuExpanded(true)
                  }}
                  onFocus={() => {
                    setExpandedGroupId(undefined)
                    setAuxiliaryMenuExpanded(true)
                  }}
                  style={selectGroupButtonStyle}
                >
                  <span style={selectValueStyle}>{auxiliaryMenu.label}</span>
                  <span style={selectAuxiliaryValueStyle}>{auxiliarySelectedLabel}</span>
                  <span aria-hidden="true" style={selectGroupArrowStyle}>‹</span>
                </button>
                {auxiliaryMenuExpanded ? (
                  <div role="group" aria-label={auxiliaryMenu.ariaLabel} style={selectGroupOptionsStyle}>
                    {auxiliaryMenu.options.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="option"
                        className="hesper-themed-select-option"
                        aria-selected={option.value === auxiliaryMenu.value}
                        onClick={() => handleAuxiliarySelect(option.value)}
                        style={{
                          ...selectOptionStyle,
                          ...(option.value === auxiliaryMenu.value ? activeSelectOptionStyle : {})
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const themedSelectHoverCss = `
.hesper-themed-select-option,
.hesper-themed-select-group-button {
  transition: background-color 120ms ease, color 120ms ease;
}

.hesper-themed-select-option:hover,
.hesper-themed-select-option:focus-visible,
.hesper-themed-select-group-button:hover,
.hesper-themed-select-group-button:focus-visible {
  background: ${themeTokens.color.hover} !important;
  color: ${themeTokens.color.text} !important;
}
`

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
  color: themeTokens.color.text,
  padding: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-start',
  gap: themeTokens.spacing.xs,
  cursor: 'pointer',
  fontSize: themeTokens.typography.body,
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
  color: themeTokens.color.textMuted,
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
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surfaceMuted,
  padding: 6,
  boxShadow: `0 10px 24px ${themeTokens.color.shadow}`
}

const selectGroupStyle: CSSProperties = {
  position: 'relative',
  display: 'grid',
  gap: 2
}

const selectMenuSeparatorStyle: CSSProperties = {
  height: 1,
  margin: '2px 6px',
  borderRadius: 999,
  background: themeTokens.color.borderSubtle
}

const selectGroupButtonStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: themeTokens.radius.sm,
  background: 'transparent',
  color: themeTokens.color.text,
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: themeTokens.spacing.sm,
  textAlign: 'left',
  cursor: 'default',
  fontSize: themeTokens.typography.body,
  overflow: 'hidden',
  whiteSpace: 'nowrap'
}

const selectGroupArrowStyle: CSSProperties = {
  flex: '0 0 auto',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body
}

const selectAuxiliaryValueStyle: CSSProperties = {
  flex: '0 0 auto',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body
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
  borderRadius: themeTokens.radius.md,
  background: themeTokens.color.surfaceMuted,
  padding: 6,
  boxShadow: `0 10px 24px ${themeTokens.color.shadow}`
}

const selectOptionStyle: CSSProperties = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: themeTokens.radius.sm,
  background: 'transparent',
  color: themeTokens.color.text,
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  display: 'block',
  textAlign: 'left',
  cursor: 'pointer',
  fontSize: themeTokens.typography.body,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
}

const activeSelectOptionStyle: CSSProperties = {
  background: themeTokens.color.softControl,
  color: themeTokens.color.text
}
