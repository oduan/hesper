import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { darkTheme } from '../theme'
import { ThemedSelect, type ThemedSelectOptionGroup } from './ThemedSelect'

export type ModelOptionGroup = ThemedSelectOptionGroup

export type SkillOption = {
  id: string
  name: string
  description?: string
}

export type ComposerSendOptions = {
  prompt: string
  displayPrompt?: string
}

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  skillOptions?: SkillOption[]
  value?: string
  running?: boolean
  onDraftChange?: (value: string) => void
  onSend: (content: string, options?: ComposerSendOptions) => void
  onStop?: () => void
  onSelectWorkspace?: () => void
  onModelChange?: (modelId: string) => void
  sendSignal?: number
}

type MentionToken = {
  start: number
  end: number
  query: string
}

const defaultModelOptions = ['mock/hesper-fast', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']

export function Composer({
  workspacePath,
  modelId,
  modelOptions = defaultModelOptions,
  modelOptionGroups,
  skillOptions = [],
  value: controlledValue,
  running = false,
  onDraftChange,
  onSend,
  onStop,
  onSelectWorkspace,
  onModelChange,
  sendSignal = 0
}: ComposerProps) {
  const [internalValue, setInternalValue] = useState('')
  const [selectionStart, setSelectionStart] = useState(0)
  const [activeSkillIndex, setActiveSkillIndex] = useState(0)
  const [dismissedMentionStart, setDismissedMentionStart] = useState<number>()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const value = controlledValue ?? internalValue
  const lastHandledSendSignalRef = useRef(0)
  const canSend = useMemo(() => value.trim().length > 0, [value])
  const mentionToken = useMemo(() => findMentionToken(value, selectionStart), [selectionStart, value])
  const filteredSkills = useMemo(() => {
    if (!mentionToken || skillOptions.length === 0) return []
    const query = mentionToken.query.toLocaleLowerCase()
    return skillOptions.filter((skill) => skill.name.toLocaleLowerCase().includes(query))
  }, [mentionToken, skillOptions])
  const showSkillMenu = Boolean(mentionToken && mentionToken.start !== dismissedMentionStart && filteredSkills.length > 0)

  const setComposerValue = useCallback((nextValue: string) => {
    if (controlledValue === undefined) {
      setInternalValue(nextValue)
    }
    onDraftChange?.(nextValue)
    setDismissedMentionStart(undefined)
  }, [controlledValue, onDraftChange])

  const updateSelectionStart = useCallback(() => {
    setSelectionStart(textareaRef.current?.selectionStart ?? 0)
  }, [])

  const focusTextarea = useCallback((cursor?: number) => {
    window.setTimeout(() => {
      textareaRef.current?.focus()
      if (cursor !== undefined) {
        textareaRef.current?.setSelectionRange(cursor, cursor)
        setSelectionStart(cursor)
      }
    }, 0)
  }, [])

  const confirmSkill = useCallback((skill: SkillOption) => {
    if (!mentionToken) return
    const replacement = `@${skill.name} `
    const nextValue = `${value.slice(0, mentionToken.start)}${replacement}${value.slice(mentionToken.end)}`
    const cursor = mentionToken.start + replacement.length
    setComposerValue(nextValue)
    setActiveSkillIndex(0)
    setDismissedMentionStart(undefined)
    focusTextarea(cursor)
  }, [focusTextarea, mentionToken, setComposerValue, value])

  const handleSend = useCallback(() => {
    if (running) {
      onStop?.()
      return
    }

    const content = value.trim()
    if (!content) {
      return
    }

    const injectedPrompt = createInjectedPrompt(content, skillOptions)
    if (injectedPrompt && injectedPrompt !== content) {
      onSend(content, { prompt: injectedPrompt, displayPrompt: content })
    } else {
      onSend(content)
    }
    setComposerValue('')
    setActiveSkillIndex(0)
  }, [onSend, onStop, running, setComposerValue, skillOptions, value])

  useEffect(() => {
    if (sendSignal <= 0 || sendSignal === lastHandledSendSignalRef.current) {
      return
    }

    lastHandledSendSignalRef.current = sendSignal
    handleSend()
  }, [handleSend, sendSignal])

  useEffect(() => {
    if (activeSkillIndex >= filteredSkills.length) {
      setActiveSkillIndex(0)
    }
  }, [activeSkillIndex, filteredSkills.length])

  return (
    <section
      aria-label="消息输入区"
      style={{
        display: 'grid',
        gap: darkTheme.spacing.sm,
        border: 0,
        borderRadius: darkTheme.radius.xl,
        background: darkTheme.color.surfaceMuted,
        padding: darkTheme.spacing.md,
        position: 'relative'
      }}
    >
      {showSkillMenu ? (
        <div role="listbox" aria-label="技能提及建议" style={skillMenuStyle}>
          {filteredSkills.map((skill, index) => {
            const selected = index === activeSkillIndex
            const label = skill.description ? `选择技能 ${skill.name}：${skill.description}` : `选择技能 ${skill.name}`
            return (
              <button
                key={skill.id}
                type="button"
                role="option"
                aria-label={label}
                aria-selected={selected}
                className="hesper-skill-mention-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => confirmSkill(skill)}
                style={{
                  ...skillOptionStyle,
                  ...(selected ? skillOptionSelectedStyle : {})
                }}
              >
                <span style={skillNameStyle}>{skill.name}</span>
              </button>
            )
          })}
        </div>
      ) : null}
      <textarea
        ref={textareaRef}
        className="hesper-theme-scrollbar"
        aria-label="消息输入框"
        placeholder="输入消息，支持 @skills"
        rows={4}
        value={value}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
          setComposerValue(event.target.value)
          setSelectionStart(event.target.selectionStart)
        }}
        onClick={updateSelectionStart}
        onKeyUp={updateSelectionStart}
        onSelect={updateSelectionStart}
        onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
          if (showSkillMenu) {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setActiveSkillIndex((index) => (index + 1) % filteredSkills.length)
              return
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setActiveSkillIndex((index) => (index <= 0 ? filteredSkills.length - 1 : index - 1))
              return
            }
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
              event.preventDefault()
              const skill = filteredSkills[activeSkillIndex]
              if (skill) confirmSkill(skill)
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setDismissedMentionStart(mentionToken?.start)
              setActiveSkillIndex(0)
              return
            }
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            handleSend()
          }
        }}
        style={textareaStyle}
      />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: darkTheme.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hesper-soft-control"
          aria-label="选择工作目录"
          onClick={() => onSelectWorkspace?.()}
          style={controlButtonStyle}
        >
          工作目录：{workspacePath ?? '未设置'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: darkTheme.spacing.xs, flexWrap: 'wrap' }}>
          <div style={modelControlStyle}>
            <ThemedSelect
              ariaLabel="选择模型"
              value={modelId}
              options={modelOptions}
              {...(modelOptionGroups ? { optionGroups: modelOptionGroups } : {})}
              {...(onModelChange ? { onChange: onModelChange } : {})}
              minWidth={0}
              maxWidth={240}
              menuPlacement="top"
            />
          </div>
          <button
            type="button"
            className="hesper-send-button"
            aria-label={running ? '停止' : '发送'}
            disabled={!running && !canSend}
            onClick={handleSend}
            style={{
              ...sendButtonStyle,
              opacity: running || canSend ? 1 : 0.45,
              cursor: running || canSend ? 'pointer' : 'not-allowed'
            }}
          >
            {running ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <rect x="8" y="8" width="8" height="8" rx="1.5" fill="currentColor" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" style={sendIconStyle}>
                <path d="M12 17V7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                <path d="M6.5 12.5 12 7l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </section>
  )
}

function findMentionToken(value: string, caret: number): MentionToken | undefined {
  if (caret < 0) return undefined
  const nextChar = value[caret]
  if (nextChar && !/\s/.test(nextChar)) return undefined
  const beforeCaret = value.slice(0, caret)
  const match = /(^|\s)@([^\s@]*)$/.exec(beforeCaret)
  if (!match || match.index === undefined) return undefined
  const prefix = match[1] ?? ''
  return {
    start: match.index + prefix.length,
    end: caret,
    query: match[2] ?? ''
  }
}

function createInjectedPrompt(content: string, skills: SkillOption[]): string | undefined {
  const referencedSkills = findReferencedSkills(content, skills)
  if (referencedSkills.length === 0) return undefined

  const lines = referencedSkills.flatMap((skill) => [
    `- 技能：${skill.name}`,
    ...(skill.description ? [`  简介：${skill.description}`] : [])
  ])
  return `以下是用户通过 @ 提及的技能。请参考技能名称和简介理解用户意图，不要假设已注入完整 SKILL.md 正文。\n${lines.join('\n')}\n\n用户消息：\n${content}`
}

function findReferencedSkills(content: string, skills: SkillOption[]): SkillOption[] {
  const found = new Set<string>()
  const orderedSkills = [...skills].sort((left, right) => right.name.length - left.name.length)
  for (const skill of orderedSkills) {
    const pattern = new RegExp(`(^|\\s)@${escapeRegExp(skill.name)}(?=\\s|$)`, 'iu')
    if (pattern.test(content)) {
      found.add(skill.id)
    }
  }
  return skills.filter((skill) => found.has(skill.id))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const skillMenuStyle = {
  position: 'absolute',
  left: darkTheme.spacing.md,
  right: darkTheme.spacing.md,
  bottom: 'calc(100% - 14px)',
  zIndex: 20,
  display: 'grid',
  gap: 2,
  maxHeight: 180,
  overflow: 'auto',
  border: `1px solid ${darkTheme.color.border}`,
  borderRadius: darkTheme.radius.lg,
  background: 'var(--hesper-color-surface, #1f2335)',
  boxShadow: '0 18px 42px rgba(0, 0, 0, 0.38)',
  padding: 6
} satisfies CSSProperties

const skillOptionStyle = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: darkTheme.radius.md,
  background: 'transparent',
  color: darkTheme.color.text,
  cursor: 'pointer',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 2,
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  textAlign: 'left',
  font: 'inherit'
} satisfies CSSProperties

const skillOptionSelectedStyle = {
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))'
} satisfies CSSProperties

const skillNameStyle = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const textareaStyle = {
  width: '100%',
  boxSizing: 'border-box',
  display: 'block',
  resize: 'none',
  minHeight: 96,
  maxHeight: 210,
  overflow: 'auto',
  borderRadius: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: darkTheme.color.text,
  padding: '0 1px',
  fontFamily: 'inherit',
  fontSize: darkTheme.typography.body,
  fontWeight: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.5
} satisfies CSSProperties

const controlButtonStyle = {
  borderRadius: darkTheme.radius.md,
  border: 0,
  outline: 0,
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))',
  color: darkTheme.color.textMuted,
  cursor: 'pointer',
  padding: `${darkTheme.spacing.xs} ${darkTheme.spacing.sm}`,
  fontSize: darkTheme.typography.body,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const modelControlStyle = {
  display: 'flex',
  alignItems: 'center',
  color: darkTheme.color.textMuted,
  fontSize: darkTheme.typography.body
} satisfies CSSProperties

const sendButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: '999px',
  border: 0,
  outline: 0,
  background: 'var(--hesper-color-soft-control, rgba(122, 162, 247, 0.14))',
  color: darkTheme.color.text,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1
} satisfies CSSProperties

const sendIconStyle = {
  width: 23,
  height: 23,
  display: 'block'
} satisfies CSSProperties
