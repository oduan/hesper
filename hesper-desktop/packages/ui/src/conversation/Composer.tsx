import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type KeyboardEvent } from 'react'
import { themeTokens } from '../theme'
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

export type ComposerSkillMention = {
  start: number
  end: number
  skill: SkillOption
}

export type ComposerProps = {
  workspacePath?: string
  modelId: string
  modelOptions?: string[]
  modelOptionGroups?: ModelOptionGroup[]
  skillOptions?: SkillOption[]
  skillMentions?: ComposerSkillMention[]
  value?: string
  running?: boolean
  onDraftChange?: (value: string) => void
  onSkillMentionsChange?: (mentions: ComposerSkillMention[]) => void
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

type SkillMentionRange = ComposerSkillMention

type ComposerSegment =
  | { kind: 'text'; text: string }
  | { kind: 'skill'; text: string; skill: SkillOption }

const defaultModelOptions = ['mock/hesper-fast', 'openai/gpt-4o', 'anthropic/claude-sonnet-4-20250514']

export function Composer({
  workspacePath,
  modelId,
  modelOptions = defaultModelOptions,
  modelOptionGroups,
  skillOptions = [],
  skillMentions: controlledSkillMentions,
  value: controlledValue,
  running = false,
  onDraftChange,
  onSkillMentionsChange,
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
  const [textareaScrollTop, setTextareaScrollTop] = useState(0)
  const [internalSkillMentions, setInternalSkillMentions] = useState<SkillMentionRange[]>([])
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const skillOptionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const value = controlledValue ?? internalValue
  const selectedSkillMentions = controlledSkillMentions ?? internalSkillMentions
  const lastHandledSendSignalRef = useRef(0)
  const canSend = useMemo(() => value.trim().length > 0, [value])
  const mentionToken = useMemo(() => findMentionToken(value, selectionStart), [selectionStart, value])
  const skillMentionRanges = useMemo(() => normalizeSkillMentionRanges(value, selectedSkillMentions), [selectedSkillMentions, value])
  const composerSegments = useMemo(() => createComposerSegments(value, skillMentionRanges), [skillMentionRanges, value])
  const hasSkillMentionPills = skillMentionRanges.length > 0
  const filteredSkills = useMemo(() => {
    if (!mentionToken || skillOptions.length === 0) return []
    const query = mentionToken.query.toLocaleLowerCase()
    return skillOptions.filter((skill) => skill.name.toLocaleLowerCase().includes(query))
  }, [mentionToken, skillOptions])
  const showSkillMenu = Boolean(mentionToken && mentionToken.start !== dismissedMentionStart && filteredSkills.length > 0)

  const setComposerValue = useCallback((nextValue: string, nextSkillMentions?: SkillMentionRange[]) => {
    if (controlledValue === undefined) {
      setInternalValue(nextValue)
    }
    const resolvedSkillMentions = nextSkillMentions ?? (nextValue.length === 0 ? [] : undefined)
    if (resolvedSkillMentions !== undefined) {
      if (controlledSkillMentions === undefined) {
        setInternalSkillMentions(resolvedSkillMentions)
      }
      onSkillMentionsChange?.(resolvedSkillMentions)
    }
    onDraftChange?.(nextValue)
    setDismissedMentionStart(undefined)
  }, [controlledSkillMentions, controlledValue, onDraftChange, onSkillMentionsChange])

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
    const mentionText = createSkillMentionText(skill)
    const replacement = `${mentionText} `
    const nextValue = `${value.slice(0, mentionToken.start)}${replacement}${value.slice(mentionToken.end)}`
    const cursor = mentionToken.start + replacement.length
    const shiftedMentions = adjustSkillMentionRanges(value, nextValue, skillMentionRanges, mentionToken.start, mentionToken.end)
    const nextSkillMentions = insertSkillMentionRange(shiftedMentions, {
      start: mentionToken.start,
      end: mentionToken.start + mentionText.length,
      skill
    })
    setComposerValue(nextValue, nextSkillMentions)
    setActiveSkillIndex(0)
    setDismissedMentionStart(undefined)
    focusTextarea(cursor)
  }, [focusTextarea, mentionToken, setComposerValue, skillMentionRanges, value])

  const deleteSkillMentionAtSelection = useCallback((key: 'Backspace' | 'Delete') => {
    const textarea = textareaRef.current
    if (!textarea) return false

    const deletion = createSkillMentionDeletion(value, textarea.selectionStart, textarea.selectionEnd, key, skillMentionRanges)
    if (!deletion) return false

    const nextSkillMentions = adjustSkillMentionRanges(value, deletion.value, skillMentionRanges, deletion.start, deletion.end)
    setComposerValue(deletion.value, nextSkillMentions)
    setActiveSkillIndex(0)
    setDismissedMentionStart(undefined)
    focusTextarea(deletion.cursor)
    return true
  }, [focusTextarea, setComposerValue, skillMentionRanges, value])

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
    setComposerValue('', [])
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

  useEffect(() => {
    if (!showSkillMenu) return
    skillOptionRefs.current[activeSkillIndex]?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [activeSkillIndex, filteredSkills.length, showSkillMenu])

  return (
    <section
      aria-label="消息输入区"
      style={{
        display: 'grid',
        gap: themeTokens.spacing.sm,
        border: 0,
        borderRadius: themeTokens.radius.xl,
        background: themeTokens.color.surfaceMuted,
        padding: themeTokens.spacing.md,
        position: 'relative'
      }}
    >
      {showSkillMenu ? (
        <>
          <style>{skillMenuScrollbarCss}</style>
          <div role="listbox" aria-label="技能提及建议" className="hesper-skill-mention-menu" style={skillMenuStyle}>
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
                ref={(node) => {
                  skillOptionRefs.current[index] = node
                }}
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
        </>
      ) : null}
      <div style={editorWrapperStyle}>
        {hasSkillMentionPills ? (
          <div aria-hidden="true" style={{ ...highlightMirrorStyle, transform: `translateY(-${textareaScrollTop}px)` }}>
            {composerSegments.map((segment, index) => segment.kind === 'skill' ? (
              <span key={`${segment.skill.id}-${index}`} data-skill-mention-pill="true" style={skillMentionPillStyle}>{segment.text}</span>
            ) : (
              <span key={`text-${index}`}>{segment.text}</span>
            ))}
          </div>
        ) : null}
        {hasSkillMentionPills ? <style>{skillMentionSelectionCss}</style> : null}
        <textarea
          ref={textareaRef}
          className={hasSkillMentionPills ? 'hesper-theme-scrollbar hesper-skill-mention-textarea' : 'hesper-theme-scrollbar'}
          aria-label="消息输入框"
          placeholder="输入消息，支持 @skills"
          rows={4}
          value={value}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            const nextValue = event.target.value
            setComposerValue(nextValue, adjustSkillMentionRanges(value, nextValue, skillMentionRanges))
            setSelectionStart(event.target.selectionStart)
          }}
          onClick={updateSelectionStart}
          onKeyUp={updateSelectionStart}
          onSelect={updateSelectionStart}
          onScroll={(event) => setTextareaScrollTop(event.currentTarget.scrollTop)}
          onKeyDown={(event: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((event.key === 'Backspace' || event.key === 'Delete') && deleteSkillMentionAtSelection(event.key)) {
              event.preventDefault()
              return
            }
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
          style={{
            ...textareaStyle,
            ...(hasSkillMentionPills ? transparentTextareaStyle : {})
          }}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: themeTokens.spacing.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          className="hesper-soft-control"
          aria-label="选择工作目录"
          onClick={() => onSelectWorkspace?.()}
          style={controlButtonStyle}
        >
          工作目录：{workspacePath ?? '未设置'}
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: themeTokens.spacing.xs, flexWrap: 'wrap' }}>
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

function createSkillMentionText(skill: SkillOption): string {
  return `@${skill.name}`
}

function normalizeSkillMentionRanges(content: string, ranges: SkillMentionRange[]): SkillMentionRange[] {
  return ranges
    .filter((range) => content.slice(range.start, range.end) === createSkillMentionText(range.skill))
    .sort((left, right) => left.start - right.start)
}

function insertSkillMentionRange(ranges: SkillMentionRange[], inserted: SkillMentionRange): SkillMentionRange[] {
  return [...ranges.filter((range) => inserted.start >= range.end || inserted.end <= range.start), inserted]
    .sort((left, right) => left.start - right.start)
}

function adjustSkillMentionRanges(
  previousValue: string,
  nextValue: string,
  ranges: SkillMentionRange[],
  explicitChangeStart?: number,
  explicitChangeEnd?: number
): SkillMentionRange[] {
  if (ranges.length === 0) return []

  const change = explicitChangeStart === undefined || explicitChangeEnd === undefined
    ? findTextChangeBounds(previousValue, nextValue)
    : { start: explicitChangeStart, oldEnd: explicitChangeEnd }
  const delta = nextValue.length - previousValue.length

  const adjusted = ranges.flatMap((range): SkillMentionRange[] => {
    if (change.oldEnd <= range.start) {
      return [{ ...range, start: range.start + delta, end: range.end + delta }]
    }
    if (change.start >= range.end) {
      return [range]
    }
    return []
  })

  return normalizeSkillMentionRanges(nextValue, adjusted)
}

function findTextChangeBounds(previousValue: string, nextValue: string): { start: number; oldEnd: number } {
  let start = 0
  while (start < previousValue.length && start < nextValue.length && previousValue[start] === nextValue[start]) {
    start += 1
  }

  let previousEnd = previousValue.length
  let nextEnd = nextValue.length
  while (previousEnd > start && nextEnd > start && previousValue[previousEnd - 1] === nextValue[nextEnd - 1]) {
    previousEnd -= 1
    nextEnd -= 1
  }

  return { start, oldEnd: previousEnd }
}

function createComposerSegments(content: string, ranges: SkillMentionRange[]): ComposerSegment[] {
  if (ranges.length === 0) return [{ kind: 'text', text: content }]

  const segments: ComposerSegment[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start > cursor) {
      segments.push({ kind: 'text', text: content.slice(cursor, range.start) })
    }
    segments.push({ kind: 'skill', text: content.slice(range.start, range.end), skill: range.skill })
    cursor = range.end
  }
  if (cursor < content.length) {
    segments.push({ kind: 'text', text: content.slice(cursor) })
  }
  return segments
}

function createSkillMentionDeletion(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  key: 'Backspace' | 'Delete',
  ranges: SkillMentionRange[]
): { value: string; cursor: number; start: number; end: number } | undefined {
  if (ranges.length === 0) return undefined

  if (selectionStart !== selectionEnd) {
    const intersecting = ranges.filter((range) => selectionStart < range.end && selectionEnd > range.start)
    if (intersecting.length === 0) return undefined

    const start = Math.min(selectionStart, ...intersecting.map((range) => range.start))
    const end = Math.max(selectionEnd, ...intersecting.map((range) => expandSkillMentionDeletionEnd(content, range.end)))
    return { value: `${content.slice(0, start)}${content.slice(end)}`, cursor: start, start, end }
  }

  const caret = selectionStart
  const range = ranges.find((candidate) => {
    const expandedEnd = expandSkillMentionDeletionEnd(content, candidate.end)
    if (key === 'Backspace') return caret > candidate.start && caret <= expandedEnd
    return caret >= candidate.start && caret < expandedEnd
  })
  if (!range) return undefined

  const end = expandSkillMentionDeletionEnd(content, range.end)
  return { value: `${content.slice(0, range.start)}${content.slice(end)}`, cursor: range.start, start: range.start, end }
}

function expandSkillMentionDeletionEnd(content: string, end: number): number {
  return end < content.length && /\s/.test(content[end] ?? '') ? end + 1 : end
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

const skillMenuScrollbarCss = `
.hesper-skill-mention-menu {
  scrollbar-width: thin;
  scrollbar-color: var(--hesper-color-scrollbar-thumb, ${themeTokens.color.scrollbarThumb}) transparent;
}
.hesper-skill-mention-menu::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
.hesper-skill-mention-menu::-webkit-scrollbar-track {
  background: transparent;
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb {
  background: var(--hesper-color-scrollbar-thumb, ${themeTokens.color.scrollbarThumb});
  border-radius: 999px;
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb:hover {
  background: var(--hesper-color-scrollbar-thumb-hover, ${themeTokens.color.scrollbarThumbHover});
}
.hesper-skill-mention-menu::-webkit-scrollbar-thumb:active {
  background: var(--hesper-color-scrollbar-thumb-active, ${themeTokens.color.scrollbarThumbActive});
}
`

const skillMentionSelectionCss = `
.hesper-skill-mention-textarea::selection {
  background: #0067d7;
  color: #ffffff;
  -webkit-text-fill-color: #ffffff;
  text-shadow: none;
}
.hesper-skill-mention-textarea::-moz-selection {
  background: #0067d7;
  color: #ffffff;
  text-shadow: none;
}
`

const skillMenuStyle = {
  position: 'absolute',
  left: themeTokens.spacing.md,
  width: '20%',
  boxSizing: 'border-box',
  bottom: 'calc(100% - 14px)',
  zIndex: 20,
  display: 'grid',
  gap: 2,
  maxHeight: 180,
  overflowY: 'auto',
  overflowX: 'hidden',
  border: `1px solid ${themeTokens.color.border}`,
  borderRadius: themeTokens.radius.lg,
  background: 'var(--hesper-color-surface, #1f2335)',
  boxShadow: '0 18px 42px rgba(0, 0, 0, 0.38)',
  padding: 6
} satisfies CSSProperties

const skillOptionStyle = {
  width: '100%',
  border: 0,
  outline: 0,
  borderRadius: themeTokens.radius.md,
  background: 'transparent',
  color: themeTokens.color.text,
  cursor: 'pointer',
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr)',
  gap: 2,
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
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

const editorWrapperStyle = {
  position: 'relative',
  minHeight: 96,
  maxHeight: 210,
  overflow: 'hidden'
} satisfies CSSProperties

const highlightMirrorStyle = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  boxSizing: 'border-box',
  pointerEvents: 'none',
  overflow: 'hidden',
  color: themeTokens.color.text,
  padding: '0 2px',
  fontFamily: 'inherit',
  fontSize: themeTokens.typography.body,
  fontWeight: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere'
} satisfies CSSProperties

const skillMentionPillStyle = {
  display: 'inline',
  border: 0,
  borderRadius: '3px',
  background: themeTokens.color.softControl,
  boxShadow: `1px 0 0 1px ${themeTokens.color.softControl}`,
  boxDecorationBreak: 'clone',
  WebkitBoxDecorationBreak: 'clone',
  color: themeTokens.color.text,
  padding: 0,
  lineHeight: 1.5,
  whiteSpace: 'pre-wrap'
} satisfies CSSProperties

const transparentTextareaStyle = {
  color: 'transparent',
  caretColor: themeTokens.color.text
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
  color: themeTokens.color.text,
  padding: '0 2px',
  fontFamily: 'inherit',
  fontSize: themeTokens.typography.body,
  fontWeight: 'inherit',
  letterSpacing: 'inherit',
  lineHeight: 1.5
} satisfies CSSProperties

const controlButtonStyle = {
  borderRadius: themeTokens.radius.md,
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.textMuted,
  cursor: 'pointer',
  padding: `${themeTokens.spacing.xs} ${themeTokens.spacing.sm}`,
  fontSize: themeTokens.typography.body,
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap'
} satisfies CSSProperties

const modelControlStyle = {
  display: 'flex',
  alignItems: 'center',
  color: themeTokens.color.textMuted,
  fontSize: themeTokens.typography.body
} satisfies CSSProperties

const sendButtonStyle = {
  width: 34,
  height: 34,
  borderRadius: '999px',
  border: 0,
  outline: 0,
  background: themeTokens.color.softControl,
  color: themeTokens.color.text,
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
